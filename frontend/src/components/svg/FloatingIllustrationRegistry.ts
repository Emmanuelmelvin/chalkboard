import {
  Book,
  Compass,
  Eraser,
  Highlighter,
  Paperclip,
  Pencil,
  Protractor,
  Ruler,
  Scissors,
} from './FloatingIllustrations';

export const floatingIllustrations = [
  { Component: Pencil, id: 'pencil' },
  { Component: Ruler, id: 'ruler' },
  { Component: Eraser, id: 'eraser' },
  { Component: Protractor, id: 'protractor' },
  { Component: Compass, id: 'compass' },
  { Component: Scissors, id: 'scissors' },
  { Component: Book, id: 'book' },
  { Component: Paperclip, id: 'paperclip' },
  { Component: Highlighter, id: 'highlighter' },
] as const;
