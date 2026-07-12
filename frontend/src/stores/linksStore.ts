import { create } from 'zustand';

export interface SavedLink {
  id: string;
  tag: string;
  strokeIds: string[];
  userId: string;
}

interface LinksState {
  links: SavedLink[];
  setLinks: (links: SavedLink[]) => void;
  addLink: (link: SavedLink) => void;
  removeLink: (linkId: string) => void;
  renameLink: (linkId: string, newTag: string) => void;
  clearLinks: () => void;
}

export const useLinksStore = create<LinksState>((set) => ({
  links: [],
  setLinks: (links) => set({ links }),
  addLink: (link) => set((state) => ({ links: [...state.links, link] })),
  removeLink: (linkId) => set((state) => ({ links: state.links.filter(l => l.id !== linkId) })),
  renameLink: (linkId, newTag) => set((state) => ({
    links: state.links.map(l => l.id === linkId ? { ...l, tag: newTag } : l),
  })),
  clearLinks: () => set({ links: [] }),
}));