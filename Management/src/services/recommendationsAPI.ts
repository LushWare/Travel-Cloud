import { API_BASE_URL } from './api.js';
import type { RecommendationMode } from '@/features/recommendations/recommendationMode';

export type RecommendationEvidence = { label: string; value: string | number | null };

export type BusinessRecommendation = {
  id: string;
  key: string;
  module: string;
  category: string;
  priority: 'high' | 'medium' | 'low' | string;
  title: string;
  summary: string;
  aiExplanation?: string | null;
  evidence: RecommendationEvidence[];
  relatedRecordIds: string[];
  action: { label: string; module: string; tab?: string };
  viewerStatus: 'new' | 'reviewed' | 'completed' | 'dismissed' | string;
  sourceAsOf: string;
};

function authHeaders() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(body?.message || 'Recommendations are temporarily unavailable.');
  }
  return body.data;
}

export function fetchRecommendations(options: { module?: string; status?: string; mode?: RecommendationMode; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams();
  if (options.module) query.set('module', options.module);
  if (options.status) query.set('status', options.status);
  query.set('mode', options.mode || 'ai');
  const suffix = query.size ? `?${query.toString()}` : '';
  return request(`/recommendations${suffix}`, { signal: options.signal }) as Promise<{
    scope: 'agency' | 'own';
    mode: RecommendationMode;
    sourceAsOf: string;
    counts: { active: number; reviewed: number };
    recommendations: BusinessRecommendation[];
  }>;
}

export function updateRecommendation(id: string, status: 'reviewed' | 'completed' | 'dismissed', reason?: string) {
  return request(`/recommendations/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}