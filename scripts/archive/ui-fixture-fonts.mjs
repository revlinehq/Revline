import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

/** Isolated UI fixtures read only the same bundled font files used by the editor. */
export async function startFixtureFontServer() {
  const server=createServer(async(request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(/^\/fonts\/[a-z0-9-]+\.(woff2|ttf)$/i.test(pathname)) {
      try { const bytes=await readFile(new URL('../public'+pathname,import.meta.url));response.writeHead(200,{'content-type':pathname.endsWith('.woff2')?'font/woff2':'font/ttf'});response.end(bytes); }
      catch {response.writeHead(404);response.end();}
      return;
    }
    response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html><body></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
