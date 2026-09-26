import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

export class GuardDO extends DurableObject<Env> {}
