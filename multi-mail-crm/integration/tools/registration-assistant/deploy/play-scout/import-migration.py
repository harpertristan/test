#!/usr/bin/env python3
"""Verify and restore a stopped assistant snapshot into an empty data directory."""
import argparse, hashlib, json, os, pathlib, shutil, tarfile, tempfile

def restore(archive, destination):
    destination = pathlib.Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Папка помощника уже содержит данные. Существующая база не заменяется.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = pathlib.Path(tempfile.mkdtemp(prefix='.assistant-import-', dir=destination.parent))
    os.chmod(temp, 0o700)
    try:
        with tarfile.open(archive, 'r:gz') as bundle:
            members = bundle.getmembers()
            if len(members) > 50000 or sum(m.size for m in members) > 10 * 1024**3:
                raise ValueError('Слишком большой архив переноса.')
            names = set()
            for member in members:
                name = pathlib.PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or '\\' in member.name or ':' in member.name or not name.parts or (name.parts[0] != 'data' and member.name != 'transfer.json'):
                    raise ValueError('Недопустимый путь в архиве.')
                if member.name in names or not (member.isfile() or member.isdir()):
                    raise ValueError('Повторяющийся путь или ссылка в архиве.')
                names.add(member.name)
                target = temp.joinpath(*name.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with bundle.extractfile(member) as source, open(target, 'xb') as output:
                        shutil.copyfileobj(source, output)
                    os.chmod(target, 0o600)
        manifest = json.loads((temp / 'transfer.json').read_text())
        if manifest.get('format') != 'registration-assistant-transfer-v1':
            raise ValueError('Неизвестный формат переноса.')
        expected = {entry['path']: entry for entry in manifest['entries']}
        actual = {p.relative_to(temp).as_posix() for p in (temp / 'data').rglob('*') if p.is_file()}
        if set(expected) != actual or 'data/assistant.sqlite' not in actual or not (temp / 'data/uploads').is_dir():
            raise ValueError('Архив неполон: список файлов не совпадает.')
        for name, entry in expected.items():
            path = temp / name
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
            if path.stat().st_size != entry['bytes'] or digest.hexdigest() != entry['sha256']:
                raise ValueError('Контрольная сумма файла не совпала. Перенос не выполнен.')
        if destination.exists():
            destination.rmdir()
        (temp / 'data').rename(destination)
        for path in [destination, *destination.rglob('*')]:
            os.chmod(path, 0o700 if path.is_dir() else 0o600)
        return len(actual)
    finally:
        shutil.rmtree(temp, ignore_errors=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('destination')
    args = parser.parse_args()
    try:
        print('Перенос проверен. Файлов:', restore(args.archive, args.destination))
    except (ValueError, OSError, tarfile.TarError, KeyError) as error:
        parser.exit(1, str(error) + '\n')
