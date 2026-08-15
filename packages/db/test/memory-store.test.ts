import { MemoryStore } from '../src/index.js'
import { describeStoreContract } from './store-contract.js'

describeStoreContract('MemoryStore', async () => new MemoryStore())
