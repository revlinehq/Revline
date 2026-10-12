import type { MediaAsset } from './types';
export async function inspectMedia(file:File):Promise<{kind:MediaAsset['kind'];duration?:number;width?:number;height?:number}> {
  const kind=file.type.split('/')[0];if(kind!=='video'&&kind!=='audio'&&kind!=='image')throw new Error(`“${file.name}” is not a supported media file.`);
  if(!file.size)throw new Error('This file is empty.');
  const url=URL.createObjectURL(file);
  try {
    if(kind==='image')return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(!image.naturalWidth||!image.naturalHeight){reject(new Error('This image has no readable dimensions.'));return;}resolve({kind,width:image.naturalWidth,height:image.naturalHeight});};image.onerror=()=>reject(new Error('This image could not be read. Try JPG, PNG, or WebP.'));image.src=url;});
    return await new Promise((resolve,reject)=>{const element=document.createElement(kind);const timer=setTimeout(()=>{element.removeAttribute('src');element.load();reject(new Error('Media metadata timed out. Try an H.264 MP4 or MP3.'));},15000);element.preload='metadata';element.onloadedmetadata=()=>{clearTimeout(timer);if(!Number.isFinite(element.duration)||element.duration<=0){reject(new Error('This file has no readable duration.'));return;}const video=element as HTMLVideoElement;if(kind==='video'&&(video.videoWidth===0)!==(video.videoHeight===0)){reject(new Error('This video has incomplete dimensions. Try an H.264 MP4.'));}else resolve({kind:kind==='video'&&!video.videoWidth&&!video.videoHeight?'audio':kind,duration:element.duration,...(kind==='video'&&video.videoWidth>0&&video.videoHeight>0?{width:video.videoWidth,height:video.videoHeight}:{})});element.removeAttribute('src');element.load();};element.onerror=()=>{clearTimeout(timer);reject(new Error('Your browser cannot decode this media. Try an H.264 MP4, WebM, or MP3.'));};element.src=url;});
  }finally{URL.revokeObjectURL(url);}
}
export type UploadedPart = { partNumber: number; etag: string };
export function uploadPart(url: string, blob: Blob, onProgress: (bytes: number) => void): Promise<UploadedPart> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url); request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.timeout = 10 * 60_000;
    request.upload.onprogress = event => onProgress(event.loaded);
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) { reject(new Error('Upload failed. Please try again.')); return; }
      try { const result = JSON.parse(request.responseText) as UploadedPart; if (!result.etag || !Number.isInteger(result.partNumber)) throw new Error(); resolve(result); }
      catch { reject(new Error('Cloudflare did not confirm this upload part.')); }
    };
    request.onerror = () => reject(new Error('Upload connection interrupted. Please try again.'));
    request.ontimeout = () => reject(new Error('The upload connection timed out. Please try again.'));
    request.send(blob);
  });
}
export async function uploadMultipart(file: File, partSize: number, getUrl: (partNumber: number) => Promise<string>, onProgress: (percent: number) => void) {
  const parts: UploadedPart[] = [];
  for (let offset = 0; offset < file.size; offset += partSize) {
    const blob = file.slice(offset, Math.min(file.size, offset + partSize));
    const partNumber = parts.length + 1;
    let uploaded: UploadedPart | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { uploaded = await uploadPart(await getUrl(partNumber), blob, bytes => onProgress(Math.min(99, Math.round((offset + bytes) / file.size * 100)))); break; }
      catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt)); }
    }
    parts.push(uploaded!);
  }
  onProgress(100); return parts;
}
