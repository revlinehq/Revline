import type { Clip, MediaAsset } from './types';
export type FocusSample=NonNullable<Clip['focus']>[number];
function chooseFace(faces:{x:number;y:number;area:number}[],previous?:{x:number;y:number}) {
  return faces.slice().sort((a,b)=>previous ? Math.hypot(a.x-previous.x,a.y-previous.y)-Math.hypot(b.x-previous.x,b.y-previous.y) : b.area-a.area)[0];
}
/** Local face detection: footage stays in the browser; only crop keyframes are saved. */
export async function trackFace(asset:MediaAsset,onProgress:(percent:number)=>void):Promise<FocusSample[]> {
  if(asset.kind!=='video'||!asset.url)throw new Error('Choose a video clip to follow its face.');
  const { FaceDetector, FilesetResolver }=await import('@mediapipe/tasks-vision');
  const vision=await FilesetResolver.forVisionTasks('/vendor/mediapipe');
  const detector=await FaceDetector.createFromOptions(vision,{baseOptions:{modelAssetPath:'/vendor/blaze-face.tflite',delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.55});
  const video=document.createElement('video');video.crossOrigin='anonymous';video.muted=true;video.preload='auto';video.src=asset.url;
  try {
    await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Video loading timed out.')),20000);video.onloadeddata=()=>{clearTimeout(timeout);resolve();};video.onerror=()=>{clearTimeout(timeout);reject(new Error('This video could not be decoded for tracking.'));};});
    const duration=Math.min(300,video.duration);const samples:FocusSample[]=[];let previous:{x:number;y:number}|undefined;let found=0;const step=.5;
    for(let time=0;time<duration;time+=step){
      if(Math.abs(video.currentTime-time)>.01)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Video seeking timed out.')),10000);video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=time;});
      const result=detector.detectForVideo(video,Math.round(time*1000));
      const faces=result.detections.flatMap(d=>d.boundingBox?[{x:(d.boundingBox.originX+d.boundingBox.width/2)/video.videoWidth,y:(d.boundingBox.originY+d.boundingBox.height/2)/video.videoHeight,area:d.boundingBox.width*d.boundingBox.height}]:[]);
      const face=chooseFace(faces,previous);if(face){found++;previous={x:Math.min(1,Math.max(0,previous?previous.x*.35+face.x*.65:face.x)),y:Math.min(1,Math.max(0,previous?previous.y*.35+face.y*.65:face.y))};}
      if(previous)samples.push({time,...previous});onProgress(Math.round(time/duration*100));await new Promise(r=>setTimeout(r,0));
    }
    if(!found)throw new Error('No clear face was found. Try a closer shot or reframe it by hand.');
    onProgress(100);return samples;
  }finally{detector.close();video.removeAttribute('src');video.load();}
}
