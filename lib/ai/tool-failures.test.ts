import { expect, test } from 'vitest';
import { hasUnresolvedToolFailures } from './tool-failures';
const call = (id:string,assetId='source') => ({type:'tool-call',toolCallId:id,toolName:'addMedia',input:{assetId,start:0}});
const error = (id:string) => ({type:'tool-error',toolCallId:id,toolName:'addMedia'});
const result = (id:string) => ({type:'tool-result',toolCallId:id,toolName:'addMedia',output:{saved:true}});
test('an error followed by a successful retry of the same input is resolved',()=>expect(hasUnresolvedToolFailures([{content:[call('first'),error('first')]},{content:[call('retry'),result('retry')]}])).toBe(false));
test('success on a different command does not conceal an unresolved error',()=>expect(hasUnresolvedToolFailures([{content:[call('first'),error('first')]},{content:[call('different','other'),result('different')]}])).toBe(true));
test('returned analysis failure remains unresolved until the same request succeeds',()=>expect(hasUnresolvedToolFailures([{content:[call('first'),{...result('first'),output:{success:false,error:'Unavailable'}}]}])).toBe(true));
