"""Verify the upload ZIP against its portable directory and SHA-256 manifests."""
import hashlib
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
name = f'123TokenBalance-{version}-win-x64'
base = root / '发布'
folder = base / name
archive_path = base / f'{name}.zip'

def digest(stream):
    value = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(chunk)
    return value.hexdigest()

def file_digest(file):
    with file.open('rb') as stream:
        return digest(stream)

def manifest(text):
    result = {}
    for line in text.splitlines():
        expected, relative = line.split('  ', 1)
        path = pathlib.PurePosixPath(relative)
        assert not path.is_absolute() and '..' not in path.parts
        assert relative not in result
        result[relative] = expected
    return result

assert folder.is_dir() and archive_path.is_file()
assert not (folder / 'data').exists()
assert not (folder / 'node_modules').exists()
required = ['123TokenBalance.exe', '123TokenBalance.App.exe', 'runtime-files.txt', 'resources/app.asar', 'VERSION.txt', 'README.md', 'docs/QA_REPORT.md', f'docs/CODE_REVIEW-{version}.md', 'licenses/dependencies.json', 'LICENSES.chromium.html']
assert all((folder / file).is_file() for file in required)
assert (folder / 'VERSION.txt').read_text(encoding='utf-8').splitlines()[0] == version
files = {p.relative_to(folder).as_posix(): p for p in folder.rglob('*') if p.is_file()}
manifest_bytes = (folder / 'SHA256SUMS.txt').read_bytes()
entries = manifest(manifest_bytes.decode('utf-8'))
assert set(entries) == set(files) - {'SHA256SUMS.txt'}
for relative, expected in entries.items():
    assert file_digest(files[relative]) == expected, f'Directory checksum: {relative}'

with zipfile.ZipFile(archive_path) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(set(archive.namelist()))
    assert set(archive.namelist()) == {f'{name}/{relative}' for relative in files}
    assert archive.read(f'{name}/SHA256SUMS.txt') == manifest_bytes
    for relative, expected in entries.items():
        with archive.open(f'{name}/{relative}') as stream:
            assert digest(stream) == expected, f'ZIP checksum: {relative}'

external = manifest((base / 'SHA256SUMS.txt').read_text(encoding='utf-8'))
for relative, expected in external.items():
    assert file_digest(base / relative) == expected, f'External checksum: {relative}'
report = {
    'result': 'passed', 'version': version, 'platform': 'Windows x64',
    'directory': name, 'zip': archive_path.name,
    'fileCount': len(files), 'directoryLogicalBytes': sum(p.stat().st_size for p in files.values()),
    'zipBytes': archive_path.stat().st_size,
    'zipSha256': external[archive_path.name],
    'exeSha256': external[f'{name}/123TokenBalance.exe'],
    'crcVerified': True, 'allDirectoryAndArchiveFilesMatch': True,
    'allManifestHashesMatch': True, 'runtimeDataAbsent': True,
    'developmentNodeModulesAbsent': True, 'requiredRuntimeAndDocumentationPresent': True,
}
(base / 'release-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
(base / f'release-validation-{version}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
