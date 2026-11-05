/** Read only a bounded number of bytes; never buffer an unbounded POST body. */
export class RequestBodyError extends Error {
 readonly status:400|408|413;
 constructor(status:400|408|413,message:string){super(message);this.status=status;this.name='RequestBodyError';}
}
export async function readCappedJson(request:Request,maxBytes:number,timeoutMs=5000):Promise<unknown>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<=0||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('Invalid server request cap');
 const declared=Number(request.headers.get('content-length')??'0');
 if(!Number.isFinite(declared)||declared<0)throw new RequestBodyError(400,'본문 길이 오류');
 if(declared>maxBytes)throw new RequestBodyError(413,'요청 크기 초과');
 const reader=request.body?.getReader();if(!reader)throw new RequestBodyError(400,'JSON 본문 없음');
 const chunks:Uint8Array[]=[];let length=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const abortHandler=()=>{void reader.cancel().catch(()=>{});};
 request.signal.addEventListener('abort',abortHandler,{once:true});
 try{
  const timedOut=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new RequestBodyError(408,'본문 수신 시간 초과')),timeoutMs);});
  while(true){const {done,value}=await Promise.race([reader.read(),timedOut]);if(done)break;
   length+=value.byteLength;
   if(length>maxBytes){await reader.cancel();throw new RequestBodyError(413,'요청 크기 초과');}
   chunks.push(value);
  }
 }catch(e){if(e instanceof RequestBodyError){void reader.cancel().catch(()=>{});throw e;}throw new RequestBodyError(400,'요청 읽기 오류');}
 finally {if(timer)clearTimeout(timer);request.signal.removeEventListener('abort',abortHandler);}
 const all=new Uint8Array(length);let offset=0;
 for(const piece of chunks){all.set(piece,offset);offset+=piece.length;}
 try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}
 catch {throw new RequestBodyError(400,'JSON 파싱 실패');}
}
