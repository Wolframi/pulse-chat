import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const STICKERS_FILE = path.join(DATA_DIR, 'stickers.json');
const STICKERS_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'stickers');

// Временное хранилище (позже перенесём в БД)
let stickerPacks: any[] = [];

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STICKERS_UPLOAD_DIR)) mkdirSync(STICKERS_UPLOAD_DIR, { recursive: true });
}

function loadStickers() {
  ensureDirs();
  if (existsSync(STICKERS_FILE)) {
    try {
      stickerPacks = JSON.parse(readFileSync(STICKERS_FILE, 'utf8'));
      return;
    } catch { /* ignore */ }
  }
  stickerPacks = [];
  saveStickers();
}

function saveStickers() {
  ensureDirs();
  writeFileSync(STICKERS_FILE, JSON.stringify(stickerPacks, null, 2));
}

loadStickers();

// GET /api/stickers - получить паки пользователя
export async function GET(request: NextRequest) {
  const token = request.headers.get('x-pulse-token');
  // Временно возвращаем все паки (позже добавим аутентификацию)
  return NextResponse.json({ ok: true, packs: stickerPacks });
}

// POST /api/stickers - создать пак
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;
    
    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: 'Название пака обязательно' });
    }

    const pack = {
      id: randomUUID(),
      name: name.trim().slice(0, 40),
      ownerId: 'temp-user', // позже заменим на реального пользователя
      stickers: [],
      createdAt: Date.now(),
    };

    stickerPacks.push(pack);
    saveStickers();

    return NextResponse.json({ ok: true, pack });
  } catch {
    return NextResponse.json({ ok: false, error: 'Ошибка создания пака' });
  }
}

// DELETE /api/stickers/:packId
export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const packId = url.pathname.split('/').pop();
  
  const index = stickerPacks.findIndex((p: any) => p.id === packId);
  if (index === -1) {
    return NextResponse.json({ ok: false, error: 'Пак не найден' });
  }

  stickerPacks.splice(index, 1);
  saveStickers();

  return NextResponse.json({ ok: true });
}