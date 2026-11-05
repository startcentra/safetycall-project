/** Session repository port for the LOCAL MOCK: intentionally ephemeral, never financial cost state.
 * A production repository would also require atomic cross-process version checks.
 */
export function createSessionRepository({max=32}={}){
  const contexts=new Map();
  return {
    get(id){return typeof id==='string'?contexts.get(id):undefined;},
    set(id,context){if(!contexts.has(id)&&contexts.size>=max)throw new Error('session repository full');contexts.set(id,context);return this;},
    delete(id){return contexts.delete(id);},
    get size(){return contexts.size;},
    *[Symbol.iterator](){yield* contexts;},
    values(){return contexts.values();}
  };
}
