import slugify from 'slugify';

export function slugifyString(input) {
  return slugify(String(input || ''), {
    lower: true,
    strict: true,
    trim: true
  })
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}


