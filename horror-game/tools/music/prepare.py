# 把 VSCO 2 社群版（CC0）的樂器取樣裁切、正規化，轉成配樂用的單聲道 MP3。
# 用法：python3 tools/music/prepare.py <VSCO-2-CE 資料夾> [輸出資料夾，預設 assets/music]
# 檔名裡的數字是 MIDI 音高（VSCO 的弦樂與鐘琴檔名比實際音高低一個八度，這裡已換算）。
# 取得原始錄音（只抓用得到的資料夾）：
#   git clone --filter=blob:none --no-checkout https://github.com/sgossner/VSCO-2-CE.git && cd VSCO-2-CE
#   git checkout HEAD -- 'Keys/Upright Piano' 'Strings/Cello Section' 'Strings/Violin Section/Trem' 'Strings/Solo Contrabass/SusNV' Percussion/Glock
import os, re, subprocess, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '../../assets/music')
os.makedirs(OUT, exist_ok=True)

PIANO = 'Keys/Upright Piano/Player_dyn{d}_rr1_{i:03d}.wav'  # 第 i 個檔 = MIDI 21 + 2i
JOBS = {}  # 輸出名稱: (來源, 長度秒, 淡出秒)
for k in range(25, 94, 4):
    JOBS[f'pno{k}'] = (PIANO.format(d=1, i=(k - 21) // 2), 5 if k < 48 else 3.5 if k < 72 else 2.5, 1.2)
for k in (25, 29, 33):
    JOBS[f'pnof{k}'] = (PIANO.format(d=3, i=(k - 21) // 2), 4, 1.5)
for name, k in (('C1', 36), ('E1', 40), ('G1', 43), ('B1', 47), ('D2', 50), ('A2', 57)):
    JOBS[f'vc{k}'] = (f'Strings/Cello Section/susvib/susvib_{name}_v1_1.wav', 6.5, 1.5)
for name, k in (('E1', 40), ('B1', 47), ('F2', 53), ('A2', 57)):
    JOBS[f'vct{k}'] = (f'Strings/Cello Section/trem/trem_{name}_v1_1.wav', 6, 1.2)
for name, k in (('E0', 28), ('A#0', 34)):
    JOBS[f'cb{k}'] = (f'Strings/Solo Contrabass/SusNV/BKCtbss_SusNV_{name}_v1_rr1.wav', 7, 2)
for name, k in (('F#3', 66), ('E4', 76), ('B4', 83)):
    JOBS[f'vnt{k}'] = (f'Strings/Violin Section/Trem/VlnEns_Trem_{name}_v1.wav', 6, 1.2)
for name, k in (('G4', 79), ('C5', 84), ('G5', 91), ('C6', 96), ('G6', 103), ('C7', 108)):
    JOBS[f'glk{k}'] = (f'Percussion/Glock/glock_medium_{name}.wav', 2.5 if k < 100 else 1.8, 0.8)

def detect(path, af=None):
    args = ['ffmpeg', '-hide_banner', '-i', path, '-af', (af + ',' if af else '') + 'volumedetect', '-f', 'null', '-']
    out = subprocess.run(args, capture_output=True, text=True).stderr
    return (float(re.search(r'max_volume: (-?[\d.]+) dB', out).group(1)), float(re.search(r'mean_volume: (-?[\d.]+) dB', out).group(1)))

# 每個音的響度對齊（以開頭一段的平均音量為準，峰值不超過 -1 dB），力度在遊戲裡控制
WINDOW = {'pno': 1.0, 'pnof': 1.0, 'glk': 0.4}
TARGET = {'pno': -17, 'pnof': -15, 'glk': -19}

for name, (src, dur, fade) in JOBS.items():
    path = os.path.join(SRC, src)
    inst = re.match(r'[a-z]+', name).group(0)
    # 從聲音真正開始的地方剪（去掉錄音前面的空白）
    peak, _ = detect(path)
    lead = f'silenceremove=start_periods=1:start_threshold={peak - 30:.1f}dB:start_silence=0.005'
    _, mean = detect(path, f'{lead},atrim=0:{WINDOW.get(inst, dur)}')
    gain = min(TARGET.get(inst, -20) - mean, -1 - peak)
    af = [lead, 'highpass=f=25', f'volume={gain:.2f}dB', f'atrim=0:{dur}', 'afade=t=in:d=0.004',
          f'afade=t=out:st={dur - fade:.3f}:d={fade}']
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-af', ','.join(af),
                    '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '48k', os.path.join(OUT, name + '.mp3')], check=True)
    print(name, src, f'{gain:+.1f} dB')
