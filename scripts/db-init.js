import {Store} from '../src/storage/store.js';
const s=new Store();await s.init();console.log('agent_state table ready');await s.close();
