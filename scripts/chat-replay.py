"""Best-effort replay velocity at import; never store audience messages/identities."""
import json
import sys
from chat_downloader import ChatDownloader

url, start, end = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
bins = [0] * (int((end-start)/10)+1)
status, messages = 'available', 0
downloader = ChatDownloader()
try:
    replay = downloader.get_chat(url, start_time=start, end_time=end,
                                 timeout=40, inactivity_timeout=10, max_messages=250000)
    for message in replay:
        time = message.get('time_in_seconds')
        if isinstance(time, (int, float)) and start <= time <= end:
            bins[min(len(bins)-1, int((time-start)/10))] += 1
            messages += 1
    # A timed partial replay is useful but must never masquerade as full coverage.
    last = max((i for i,n in enumerate(bins) if n), default=0)*10
    status = 'available' if last >= (end-start)*.9 else 'partial (bounded replay fetch)'
    if not messages:
        status = 'unavailable: no public replay messages'
except Exception as error:
    status = 'partial (replay provider interrupted)' if messages else f'unavailable: {type(error).__name__}'
finally:
    downloader.close()
print(json.dumps(dict(status=status, bins=[dict(time=i*10,count=n) for i,n in enumerate(bins)]), separators=(',', ':')))
