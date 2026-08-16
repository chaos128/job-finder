import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 나중에 준 클래스가 이기도록 병합한다 — 호출부에서 기본 스타일을 덮어쓸 수 있어야 한다. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
