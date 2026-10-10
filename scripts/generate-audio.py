"""Original procedural sound beds and UI effects. No third-party samples."""
import math, random, wave, struct
from pathlib import Path
random.seed(42)
rate=24000
out=Path(__file__).resolve().parents[1]/'public/audio'
out.mkdir(parents=True,exist_ok=True)
def save(name,duration,sample):
    with wave.open(str(out/f'{name}.wav'),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate)
        f.writeframes(b''.join(struct.pack('<h',int(max(-1,min(1,sample(i/rate)))*24000)) for i in range(int(duration*rate))))
# All fundamentals fit an integer number of periods in a four-second loop.
notes=[110,137.5,165,220]
def ambient(t):
    return sum(math.sin(2*math.pi*n*t)*(.09+.025*math.sin(2*math.pi*.25*t+j)) for j,n in enumerate(notes))
def pulse(t):
    phase=t%0.5
    return ambient(t)*.55 + math.sin(2*math.pi*55*phase)*math.exp(-phase*18)*.2 + math.sin(2*math.pi*330*t)*math.exp(-phase*24)*.04
save('ambient',4,ambient)
save('pulse',4,pulse)
save('click',.12,lambda t:(math.sin(2*math.pi*(850-400*t)*t)+random.uniform(-.3,.3))*math.exp(-t*70)*.35)
save('transition',.5,lambda t:random.uniform(-1,1)*math.sin(math.pi*t/.5)**2*.14)
