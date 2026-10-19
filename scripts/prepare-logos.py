import pathlib, tarfile, json, hashlib, urllib.request
root=pathlib.Path(__file__).resolve().parent.parent
archive=root/'artifacts/lobehub-icons-static-svg-1.95.1.tgz'
out=root/'src/assets/logos';out.mkdir(parents=True,exist_ok=True)
names=['openai','claude','gemini','deepseek','zhipu','zai','minimax','kimi','moonshot','siliconcloud','openrouter','volcengine','alibabacloud','tencent','cursor','githubcopilot']
records=[]
with tarfile.open(archive) as tar:
    entries=set(tar.getnames())
    for name in names:
        mono=f'package/icons/{name}.svg'
        if mono not in entries: raise RuntimeError('Missing logo: '+name)
        for variant,source in [('mono',mono),('color',f'package/icons/{name}-color.svg')]:
            if source not in entries:source=mono
            data=tar.extractfile(source).read()
            text=data.decode('utf-8')
            if any(item in text.lower() for item in ['<script','<foreignobject','javascript:','<image','<use','onload=']): raise RuntimeError('Active SVG rejected')
            (out/f'{name}-{variant}.svg').write_bytes(data)
            records.append({'name':name,'variant':variant,'source':source,'sha256':hashlib.sha256(data).hexdigest()})
    notice=root/'docs/brand-assets';notice.mkdir(parents=True,exist_ok=True)
    license_data=tar.extractfile('package/LICENSE').read() if 'package/LICENSE' in entries else urllib.request.urlopen('https://raw.githubusercontent.com/lobehub/lobe-icons/master/LICENSE',timeout=30).read()
    (notice/'LICENSE-lobe-icons.txt').write_bytes(license_data)
(notice/'sources.json').write_text(json.dumps({'package':'@lobehub/icons-static-svg','version':'1.95.1','repository':'https://github.com/lobehub/lobe-icons','assets':records},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Prepared {len(records)} local SVG assets')
