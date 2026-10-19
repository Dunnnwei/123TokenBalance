import pathlib,sys,zipfile,hashlib,json
folder=pathlib.Path(sys.argv[1]).resolve()
target=pathlib.Path(sys.argv[2]).resolve()
if not folder.is_dir() or target.parent != folder.parent:
    raise SystemExit('Invalid release paths')
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for file in sorted(folder.rglob('*')):
        if file.is_file():
            rel=file.relative_to(folder.parent)
            if 'data' in rel.parts:
                raise SystemExit('Refusing to publish runtime data')
            archive.write(file,rel.as_posix())
with zipfile.ZipFile(target) as archive:
    broken=archive.testzip()
    if broken: raise SystemExit('CRC mismatch: '+broken)
    for item in archive.infolist():
        relative=pathlib.PurePosixPath(item.filename)
        if relative.is_absolute() or '..' in relative.parts or relative.parts[0]!=folder.name:
            raise SystemExit('Invalid ZIP path')
    print(json.dumps({'zip_crc':'passed','entries':len(archive.infolist()),'runtime_data':'absent'}))
