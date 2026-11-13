import type { MediaAsset } from './types';
import { drawPoster, posterBlob, seekToPoster } from './poster-frame';
export async function inspectMedia(file:File,onThumbnail?:(image:Blob)=>void,waitForThumbnail=true):Promise<{kind:MediaAsset['kind'];duration?:number;width?:number;height?:number}> {
  const kind=file.type.split('/')[0];if(kind!=='video'&&kind!=='audio'&&kind!=='image')throw new Error(`“${file.name}” is not a supported media file.`);
  if(!file.size)throw new Error('This file is empty.');
  const url=URL.createObjectURL(file);
  if(kind==='image') {
    try { return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(!image.naturalWidth||!image.naturalHeight){reject(new Error('This image has no readable dimensions.'));return;}resolve({kind,width:image.naturalWidth,height:image.naturalHeight});};image.onerror=()=>reject(new Error('This image could not be read. Try JPG, PNG, or WebP.'));image.src=url;}); }
    finally { URL.revokeObjectURL(url); }
  }
    return await new Promise((resolve,reject)=>{
      const element=document.createElement(kind);let finished=false,capturing=false;
      element.preload=onThumbnail&&kind==='video'?'auto':'metadata';
      const cleanup=()=>{clearTimeout(timer);element.onloadedmetadata=null;element.onloadeddata=null;element.onerror=null;element.removeAttribute('src');element.load();URL.revokeObjectURL(url);};
      const fail=(message:string)=>{if(finished)return;finished=true;cleanup();reject(new Error(message));};
      const timer=setTimeout(()=>fail('Media metadata timed out. Try an H.264 MP4 or MP3.'),15000);
      const finish=()=>{if(finished)return;finished=true;const video=element as HTMLVideoElement;const metadata={kind:kind==='video'&&!video.videoWidth&&!video.videoHeight?'audio' as const:kind as MediaAsset['kind'],duration:element.duration,...(kind==='video'&&video.videoWidth>0&&video.videoHeight>0?{width:video.videoWidth,height:video.videoHeight}:{})};cleanup();resolve(metadata);};
      element.onloadedmetadata=()=>{
        if(!Number.isFinite(element.duration)||element.duration<=0){fail('This file has no readable duration.');return;}
        const video=element as HTMLVideoElement;
        if(kind==='video'&&(video.videoWidth===0)!==(video.videoHeight===0)){fail('This video has incomplete dimensions. Try an H.264 MP4.');return;}
        if(!onThumbnail||kind!=='video'||!video.videoWidth){finish();return;}
        // Network transfer needs metadata, not a decoded JPEG. Keep the local
        // source alive for the poster while the upload proceeds independently.
        if(!waitForThumbnail)resolve({kind:'video',duration:element.duration,width:video.videoWidth,height:video.videoHeight});
        // The poster is taken where every stored poster is (lib/editor/poster-frame), not on the black first frame.
        const capture=async()=>{
          if(finished||capturing)return;capturing=true;
          try{await seekToPoster(video);if(finished)return;const canvas=document.createElement('canvas');
            const blob=drawPoster(video,canvas)?await posterBlob(canvas):null;if(finished)return;if(blob)onThumbnail(blob);finish();
          }catch{finish();}
        };
        if(element.readyState>=2)void capture();else element.onloadeddata=()=>void capture();
      };
      element.onerror=()=>fail('Your browser cannot decode this media. Try an H.264 MP4, WebM, or MP3.');element.src=url;
    });
}
