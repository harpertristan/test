from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.schemas import CompanyInput, CompanyView, FlagInput
from app.core.db import db
from app.core.security import admin, current_user
from app.models import Company, MailAccount, User
from app.services.pending import mark_replied
from app.services.events import event

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("", response_model=list[CompanyView])
async def listing(_: User = Depends(current_user), session: AsyncSession = Depends(db)):
    return (
        await session.scalars(select(Company).order_by(Company.name, Company.id))
    ).all()


@router.post("", response_model=CompanyView, status_code=201)
async def create(
    data: CompanyInput, _: User = Depends(admin), session: AsyncSession = Depends(db)
):
    company = Company(**data.model_dump())
    session.add(company)
    await session.flush()
    event(session, "companies.changed", {"company_id": str(company.id)})
    await session.commit()
    await session.refresh(company)
    return company


@router.get("/{company_id}", response_model=CompanyView)
async def detail(
    company_id: UUID,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(404, "Компания не найдена")
    return company


@router.put("/{company_id}", response_model=CompanyView)
async def edit(
    company_id: UUID,
    data: CompanyInput,
    _: User = Depends(admin),
    session: AsyncSession = Depends(db),
):
    company = await detail(company_id, _, session)
    for key, value in data.model_dump().items():
        setattr(company, key, value)
    event(session, "companies.changed", {"company_id": str(company_id)})
    await session.commit()
    return company


@router.delete("/{company_id}", status_code=204)
async def remove(
    company_id: UUID, _: User = Depends(admin), session: AsyncSession = Depends(db)
):
    company = await detail(company_id, _, session)
    if await session.scalar(
        select(func.count())
        .select_from(MailAccount)
        .where(MailAccount.company_id == company_id)
    ):
        raise HTTPException(409, "Сначала удалите ящики компании")
    await session.delete(company)
    event(session, "companies.changed", {})
    await session.commit()


@router.post("/{company_id}/flag", response_model=CompanyView)
async def flag(
    company_id: UUID,
    data: FlagInput,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    company = await detail(company_id, user, session)
    company.is_flagged = data.value
    event(session, "companies.changed", {"company_id": str(company_id)})
    await session.commit()
    return company


@router.post("/{company_id}/replied", status_code=204)
async def replied(
    company_id: UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db),
):
    await detail(company_id, user, session)
    # Common account locks prevent races with classification and sending.
    await session.scalars(
        select(MailAccount)
        .where(MailAccount.company_id == company_id)
        .order_by(MailAccount.id)
        .with_for_update()
    )
    await mark_replied(session, company_id=company_id)
    event(session, "messages.changed", {"company_id": str(company_id)})
    await session.commit()
