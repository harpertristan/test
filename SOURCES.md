# Источники Play Scout 3.0

Основное рабочее место — /crm. Настройка: [START_HERE.md](START_HERE.md).

## Прямые источники

- **Google Play**: весь поисковый каталог, затем проверка категорий Finance / Business / Productivity / Tools; похожие приложения и разработчики. Коннектор следует доступным токенам пагинации без квоты 250 результатов. Публичная выдача отличается от персональных рекомендаций телефона.
- **Apple Search API**: itunes.apple.com/search, 27 стран ЕС, Finance / Business / Productivity / Utilities. До 200 результатов на запрос — ограничение Apple; полного перечисления каталога API не даёт. Отдельного ключа не нужно.
- **Публичные страницы и RSS/Atom**: исходные снимки и последующие изменения; данные не требуют ключа Brave. Не все реестры, динамические таблицы и страницы со входом читаются этим способом.

## Публичная выдача Brave

Все выбранные пары «источник × запрос» проверяются за запуск. Коннектор получает доступные страницы Brave (смещения 0–9), останавливается на конце / повторе выдачи. Полнота индекса и доступность источника не гарантируются. Включение домена в каталог не означает наличие прямого API или договора на полный поток данных.

| Источник | Тип | Домены |
|---|---|---|
| LinkedIn | social | [linkedin.com](https://linkedin.com/) |
| Facebook | social | [facebook.com](https://facebook.com/) |
| Finextra | news | [finextra.com](https://finextra.com/) |
| Sifted | news | [sifted.eu](https://sifted.eu/) |
| Tech.eu / EU-Startups | news | [tech.eu](https://tech.eu/), [eu-startups.com](https://eu-startups.com/) |
| The Paypers / FinTech Futures / FF News | news | [thepaypers.com](https://thepaypers.com/), [fintechfutures.com](https://fintechfutures.com/), [ffnews.com](https://ffnews.com/) |
| Пресс-релизы: Business Wire / GlobeNewswire / PR Newswire | news | [businesswire.com](https://businesswire.com/), [globenewswire.com](https://globenewswire.com/), [prnewswire.com](https://prnewswire.com/) |
| Fintech Baltic / Fintech News Switzerland | news | [fintechbaltic.com](https://fintechbaltic.com/), [fintechnews.ch](https://fintechnews.ch/) |
| Партнёры: Banking Circle / OpenPayd / Swan | partner | [bankingcircle.com](https://bankingcircle.com/), [openpayd.com](https://openpayd.com/), [swan.io](https://swan.io/) |
| Партнёры: ClearBank / Modulr / Treezor / Solaris | partner | [clear.bank](https://clear.bank/), [modulrfinance.com](https://modulrfinance.com/), [treezor.com](https://treezor.com/), [solarisgroup.com](https://solarisgroup.com/) |
| This Week in Fintech / Fintech Brainfood | newsletter | [thisweekinfintech.com](https://thisweekinfintech.com/), [fintechbrainfood.com](https://fintechbrainfood.com/) |
| Reddit: fintech / smallbusiness / digitalnomad / eupersonalfinance | community | [reddit.com](https://reddit.com/) |
| Форумы: UK Business Forums / OffshoreCorpTalk | community | [ukbusinessforums.co.uk](https://ukbusinessforums.co.uk/), [offshorecorptalk.com](https://offshorecorptalk.com/) |
| Product Hunt / YC / Seedcamp / Antler / Techstars | directory | [producthunt.com](https://producthunt.com/), [ycombinator.com](https://ycombinator.com/), [seedcamp.com](https://seedcamp.com/), [antler.co](https://antler.co/), [techstars.com](https://techstars.com/) |
| Реестры: EBA / Банк Литвы / REGAFI | register | [eba.europa.eu](https://eba.europa.eu/), [lb.lt](https://lb.lt/), [regafi.fr](https://regafi.fr/) |
| Реестры: BaFin / Центральный банк Ирландии | register | [bafin.de](https://bafin.de/), [registers.centralbank.ie](https://registers.centralbank.ie/) |
| Trustpilot · отзывы и новые названия | community | [trustpilot.com](https://trustpilot.com/) |
| TrustFinance · финансовые сервисы | community | [trustfinance.com](https://trustfinance.com/) |
| Реестры: DNB / NBB / CSSF | register | [dnb.nl](https://dnb.nl/), [nbb.be](https://nbb.be/), [cssf.lu](https://cssf.lu/) |
| Реестры: Banco de España / Banca d’Italia / Banco de Portugal | register | [bde.es](https://bde.es/), [bancaditalia.it](https://bancaditalia.it/), [bportugal.pt](https://bportugal.pt/) |
| Реестры: MFSA / Центральный банк Кипра | register | [mfsa.mt](https://mfsa.mt/), [centralbank.cy](https://centralbank.cy/) |
| Реестры: Finantsinspektsioon / Latvijas Banka | register | [fi.ee](https://fi.ee/), [bank.lv](https://bank.lv/) |
| ESMA · MiCA / CASP и предупреждения | register | [esma.europa.eu](https://esma.europa.eu/) |
| Ранние веб-запуски: BetaList / F6S / Wellfound / Dealroom | directory | [betalist.com](https://betalist.com/), [f6s.com](https://f6s.com/), [wellfound.com](https://wellfound.com/), [dealroom.co](https://dealroom.co/) |
| Криптобанки: Circle / Bridge / BVNK / Zero Hash | partner | [circle.com](https://circle.com/), [bridge.xyz](https://bridge.xyz/), [bvnk.com](https://bvnk.com/), [zerohash.com](https://zerohash.com/) |
| Реестры: Швеция / Дания / Финляндия | register | [fi.se](https://fi.se/), [finanstilsynet.dk](https://finanstilsynet.dk/), [finanssivalvonta.fi](https://finanssivalvonta.fi/) |
| Реестры: Австрия / Польша / Чехия | register | [fma.gv.at](https://fma.gv.at/), [knf.gov.pl](https://knf.gov.pl/), [cnb.cz](https://cnb.cz/) |
| Криптоавторизации: AMF / AFM / CNMV | register | [amf-france.org](https://amf-france.org/), [afm.nl](https://afm.nl/), [cnmv.es](https://cnmv.es/) |
| Реестры: Болгария / Румыния / Венгрия | register | [bnb.bg](https://bnb.bg/), [bnr.ro](https://bnr.ro/), [mnb.hu](https://mnb.hu/) |
| Реестры: Хорватия / Греция / Словения / Словакия | register | [hnb.hr](https://hnb.hr/), [bankofgreece.gr](https://bankofgreece.gr/), [bsi.si](https://bsi.si/), [nbs.sk](https://nbs.sk/) |
| ECB · банки под надзором | register | [bankingsupervision.europa.eu](https://bankingsupervision.europa.eu/) |
| Apple App Store | app | [apps.apple.com](https://apps.apple.com/) |
| Сайты бизнес-сервисов · веб-поиск | web |  |

## EMI / MiCA

Выделены EMI и CASP по MiCA. Поиск проводится по официальным доменам EBA / ESMA и национальных регуляторов ЕС. Прямое наблюдение по умолчанию включает читаемые страницы ESMA MiCA, Банка Литвы и EBA; первый просмотр создаёт исходный снимок. На недоступном / обязательном JavaScript-содержимом показывается ошибка. Это не полная автоматическая выгрузка всех разрешений.

До разбора регуляторная ссылка — зацепка. Дата решения принимается только из официальной цитаты, а не из даты обнаружения. Заявки, отзыв разрешения и VASP не считаются действующей CASP-авторизацией. Лицензия EMI / CASP не доказывает, что компания выдаёт бизнесу IBAN ЕС.

## Раннее обнаружение

Общие поиски дополняют рекомендации магазинов, сообщения партнёров инфраструктуры, листы ожидания, бета-запуски, каталоги стартапов, пресс-релизы и новые регуляторные публикации. Для известных сервисов важны изменения business / pricing / legal / FAQ и объявлений партнёров. Trustpilot полезен как источник новых названий и отзывов; это не подтверждение лицензии или страны IBAN. Отсутствие отзывов не исключает новый проект.

Публикации с рассуждениями, записи реестра, работающий сервис и первое обнаружение отмечаются отдельно. Ни один публичный поисковик не гарантирует, что исследователь узнает о проекте первым.
