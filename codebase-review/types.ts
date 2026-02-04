export interface Article {
  id: string;
  title: string;
  author: string;
  url: string;
  description: string;
  reason: string;
  tags: string[];
  rating?: number; // 0-5
  dateAdded: string; // ISO date string
  read: boolean;
  isVerified: boolean;
}

export interface TagWeight {
  tag: string;
  weight: number; // 0 to 100
}

export interface UserPreferences {
  weights: TagWeight[];
  lastGenerated: string | null;
}

export enum ViewMode {
  RECOMMENDATIONS = 'RECOMMENDATIONS',
  HISTORY = 'HISTORY',
  INSIGHTS = 'INSIGHTS'
}