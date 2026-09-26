import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

export class AdminDO extends DurableObject<Env> {}
