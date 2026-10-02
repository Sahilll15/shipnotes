import Image from 'next/image';
import type { Person } from '@/lib/shape.ts';

export function Avatar({ person, size = 20, ring = false }: { person: Person | null; size?: number; ring?: boolean }) {
  const cls = `inline-block shrink-0 rounded-full bg-wash ${ring ? 'ring-2 ring-white' : 'ring-1 ring-line'}`;
  if (!person?.avatar) return <span aria-hidden className={cls} style={{ width: size, height: size }} />;
  const src = `${person.avatar}${person.avatar.includes('?') ? '&' : '?'}s=${size * 2}`;
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      unoptimized
      className={cls}
      style={{ width: size, height: size }}
    />
  );
}
