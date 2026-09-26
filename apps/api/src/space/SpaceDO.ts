import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

export class SpaceDO extends DurableObject<Env> {}
