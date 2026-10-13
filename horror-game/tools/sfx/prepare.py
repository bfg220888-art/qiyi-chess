# 把下載的原始音效裁切、正規化，轉成遊戲用的單聲道 MP3。
# 用法：python3 tools/sfx/prepare.py <原始音效資料夾> [輸出資料夾，預設 assets/sfx]
# 每個檔案的來源與授權寫在 CREDITS.md。
import os, re, subprocess, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '../../assets/sfx')
os.makedirs(OUT, exist_ok=True)

# 輸出名稱: (來源, 起點秒, 終點秒或 None, 峰值 dBFS, 結尾淡出秒)
JOBS = {
    **{f'step{i}': (f'gates/freesound__step_rock_{i}.ogg', 0, None, -1, 0.03) for i in range(8)},
    'door_open0': ('kenney/rpg-audio__dooropen_1.ogg', 0, None, -1, 0.05),
    'door_open1': ('kenney/rpg-audio__dooropen_2.ogg', 0, None, -1, 0.05),
    'door_close0': ('kenney/rpg-audio__doorclose_1.ogg', 0, None, -1, 0.05),
    'door_close1': ('kenney/rpg-audio__doorclose_4.ogg', 0, None, -1, 0.05),
    'creak0': ('kenney/rpg-audio__creak1.ogg', 0, None, -1, 0.05),
    'creak1': ('kenney/rpg-audio__creak2.ogg', 0, None, -1, 0.05),
    'creak2': ('kenney/rpg-audio__creak3.ogg', 0, None, -1, 0.05),
    'door_creak': ('berklee/door_creak1.mp3', 0.08, 3.2, -1, 0.3),
    'door_slam': ('berklee/DoorSlam1.mp3', 0, None, -1, 0.1),
    'latch': ('kenney/rpg-audio__metallatch.ogg', 0, None, -1, 0.03),
    'click': ('kenney/rpg-audio__metalclick.ogg', 0, None, -1, 0.03),
    'locker': ('berklee/locker2.mp3', 0.4, 2.0, -1, 0.3),
    'scream0': ('berklee/scream.mp3', 0.2, 2.75, -1, 0.3),
    'scream1': ('berklee/scream_1.mp3', 0, 3.2, -1, 0.4),
    'heart_lub': ('nuzky/sounds__heartbeat.ogg', 0.89, 1.15, -1, 0.06),
    'heart_dub': ('nuzky/sounds__heartbeat.ogg', 1.15, 1.45, -1, 0.08),
    'rain': ('salem/sound__rain_muffled.ogg', 0, 34, -3, 0),
    'thunder_near': ('salem/sound__thunder_close.ogg', 0, 9, -1, 2.5),
    'thunder_far': ('salem/sound__thunder_far.ogg', 0, None, -1, 1.0),
    'glass': ('godot/sfx__glass_breaking.wav', 0, None, -1, 0.2),
    **{f'glass_hit{i}': (f'kenney/impact-sounds__impactglass_heavy_00{i}.ogg', 0, None, -1, 0.05) for i in range(3)},
    'shutter': ('sfxkit/sfx-candidates__shutter_old_camera_01.wav', 0.45, 1.5, -1, 0.1),
    'paper0': ('sfxkit/sfx-candidates__paper_page_turn_01.wav', 0, None, -1, 0.05),
    'paper1': ('sfxkit/sfx-candidates__paper_page_turn_05.wav', 0, None, -1, 0.05),
    'pills': ('berklee/pillrattle2.mp3', 0.05, None, -1, 0.1),
    'squeak': ('berklee/squeaking_long.mp3', 6.0, 9.5, -1, 0.4),
    **{f'metal{i}': (f'kenney/impact-sounds__impactmetal_heavy_00{i}.ogg', 0, None, -1, 0.05) for i in range(5)},
    'bang': ('berklee/underground_bang-VERYcompressed.mp3', 0, None, -1, 0.4),
    'metal_reverb': ('berklee/metal_reverb_hit1.mp3', 0, None, -1, 0.5),
    'phone': ('berklee/old_phone1.mp3', 0.2, 3.6, -2, 0.3),
    'woosh': ('sonicpi/samples__ambi_dark_woosh.flac', 0, None, -1, 0.5),
    'buzz': ('liminal/audio__hum.mp3', 0, None, -3, 0),
}

def peak_db(path, ss, to):
    args = ['ffmpeg', '-hide_banner', '-ss', str(ss)] + (['-to', str(to)] if to else []) + ['-i', path, '-af', 'volumedetect', '-f', 'null', '-']
    out = subprocess.run(args, capture_output=True, text=True).stderr
    return float(re.search(r'max_volume: (-?[\d.]+) dB', out).group(1))

for name, (src, ss, to, target, fade) in JOBS.items():
    path = os.path.join(SRC, src)
    gain = target - peak_db(path, ss, to)
    dur = (to - ss) if to else float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout) - ss
    af = [f'volume={gain:.2f}dB']
    if fade > 0: af.append(f'afade=t=out:st={max(0, dur - fade):.3f}:d={fade}')
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(ss)] + (['-to', str(to)] if to else []) + ['-i', path,
            '-af', ','.join(af), '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '5' if name != 'rain' else '7', os.path.join(OUT, name + '.mp3')]
    subprocess.run(args, check=True)
    print(f'{name:14s} {dur:6.2f}s gain {gain:+.1f} dB')
