/// <reference types="astro/client" />

export interface SessionUser {
  login: string;
  id: number;
  name?: string;
  avatar_url?: string;
  [key: string]: unknown;
}

export interface SessionData {
  user: SessionUser;
  accessToken: string;
  createdAt: number;
  expiresAt: number;
  [key: string]: unknown;
}

declare global {
  namespace App {
    interface Locals {
      user?: SessionUser | null;
      accessToken?: string | null;
    }
  }
}

export {};
