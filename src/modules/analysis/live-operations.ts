/** Single-process abort of in-flight requests. Termination is persisted by CostGuard. */
const active = new Map<string,Set<AbortController>>();
export function registerLiveOperation(id:string):AbortController {
 const controller=new AbortController();
 const set=active.get(id)??new Set<AbortController>();set.add(controller);active.set(id,set);
 return controller;
}
export function unregisterLiveOperation(id:string,controller:AbortController){
 const set=active.get(id);if(!set)return;set.delete(controller);if(!set.size)active.delete(id);
}
export function abortLiveExperiment(id:string){const set=active.get(id);if(!set)return 0;
 for(const controller of set)controller.abort();return set.size;
}
