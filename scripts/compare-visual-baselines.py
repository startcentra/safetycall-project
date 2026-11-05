#!/usr/bin/env python3
"""SafeCall optional screenshot diff. No screenshots are created by this script.

Usage:
  python scripts/compare-visual-baselines.py --baseline docs/screenshots/v123 \
      --candidate /path/to/new/screenshots --output /path/to/local/report.json
Requires Pillow. Candidate images must come from a real browser run and must
have matching names/dimensions. Dynamic time/Case ID fields need stable capture
or a separate, explicitly documented mask policy before release sign-off.
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat


def compare(base, new):
    with Image.open(base) as im1, Image.open(new) as im2:
        if im1.size != im2.size:
            return {'status': 'DIMENSION_MISMATCH', 'baselineSize': im1.size, 'candidateSize': im2.size}
        a=im1.convert('RGB');b=im2.convert('RGB')
        diff=ImageChops.difference(a,b)
        stat=ImageStat.Stat(diff)
        mae=sum(stat.mean)/3
        pixels = diff.get_flattened_data() if hasattr(diff, 'get_flattened_data') else diff.getdata()
        changes=sum(1 for px in pixels if max(px)>20)
        return {'status': 'PASS' if mae <= 2.0 and changes/(im1.width*im1.height)<=0.01 else 'REVIEW',
                'mae':round(mae,4), 'pixelsChangedOver20':changes,
                'changedFraction':round(changes/(im1.width*im1.height),6), 'width':im1.width,'height':im1.height}


def main():
    parser=argparse.ArgumentParser(description='Compare separately captured screenshots with a preserved baseline.')
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--output', required=True)
    args=parser.parse_args()
    baseline=Path(args.baseline).resolve();candidate=Path(args.candidate).resolve();out=Path(args.output).resolve()
    if baseline==candidate:
        parser.error('Baseline and candidate must be DIFFERENT paths (no self-comparison for release validation).')
    files=sorted(baseline.glob('*.png'))
    if not files:
        parser.error('No baseline PNGs found.')
    rows=[]
    for f in files:
        g=candidate/f.name
        if not g.is_file():
            rows.append({'file':f.name,'status':'NOT_VERIFIED','reason':'candidate screenshot missing'})
            continue
        rows.append({'file':f.name,**compare(f,g)})
    status='PASS' if all(r['status']=='PASS' for r in rows) else 'NOT_VERIFIED_OR_REVIEW'
    result={'status':status,'baseline':str(baseline),'candidate':str(candidate),'count':len(rows), 'results':rows,
            'warning':'Pixel diff does not prove accessibility or functional correctness. Dynamic UI must be stabilized.'}
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'{status}: {len(rows)} baseline screenshots; report: {out}')
    return 0 if status=='PASS' else 2

if __name__=='__main__':
    raise SystemExit(main())
