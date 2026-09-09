import { NextRequest, NextResponse } from 'next/server';

// Ваш ключ от Klipy
const KLIPY_API_KEY = process.env.KLIPY_API_KEY || 'oZ5lTG1neQndpNbBN1COY0lPQ1Bu3IH4C7qonUb9jXcaxUL4dPFYLDenvbYgjpkq';
const KLIPY_BASE = 'https://api.klipy.com/api/v1';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const offset = Number(searchParams.get('pos')) || 0;
    const limit = Math.min(Number(searchParams.get('limit')) || 20, 50);
    
    const isSearch = query.trim().length > 0;
    
    // Формируем URL для Klipy
    let endpoint: string;
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    
    if (isSearch) {
      endpoint = `${KLIPY_BASE}/${KLIPY_API_KEY}/gifs/search`;
      params.set('q', query.trim());
    } else {
      endpoint = `${KLIPY_BASE}/${KLIPY_API_KEY}/gifs/trending`;
    }

    const url = `${endpoint}?${params.toString()}`;
    console.log('🔍 Fetching GIFs from Klipy:', url.replace(KLIPY_API_KEY, 'HIDDEN'));

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PulseChat/1.0',
      },
    });

    // Проверяем статус ответа
    if (!response.ok) {
      console.error('Klipy API error:', response.status, response.statusText);
      return NextResponse.json(getFallbackGifs());
    }

    // Получаем текст ответа для отладки
    const text = await response.text();
    console.log('📦 Klipy response length:', text.length);
    
    // Если ответ пустой — возвращаем fallback
    if (!text || text.trim() === '') {
      console.warn('⚠️ Empty response from Klipy');
      return NextResponse.json(getFallbackGifs());
    }

    // Парсим JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error('❌ Failed to parse Klipy response:', parseError);
      console.log('📄 Response preview:', text.slice(0, 200));
      return NextResponse.json(getFallbackGifs());
    }
    
    // Проверяем структуру ответа Klipy
    // Klipy может возвращать данные в разных форматах
    let results = [];
    
    if (data.data && Array.isArray(data.data)) {
      // Формат как у GIPHY
      results = data.data.map((item: any) => ({
        id: item.id || '',
        title: item.title || '',
        url: item.images?.original?.url || item.url || '',
        preview: item.images?.fixed_width?.url || item.images?.original?.url || item.url || '',
        width: Number(item.images?.fixed_width?.width) || 320,
        height: Number(item.images?.fixed_width?.height) || 180,
      }));
    } else if (data.results && Array.isArray(data.results)) {
      // Формат как у Tenor
      results = data.results.map((item: any) => ({
        id: item.id || '',
        title: item.title || '',
        url: item.media?.gif?.url || item.url || '',
        preview: item.media?.gif?.url || item.url || '',
        width: Number(item.media?.gif?.dims?.[0]) || 320,
        height: Number(item.media?.gif?.dims?.[1]) || 180,
      }));
    } else if (Array.isArray(data)) {
      // Если пришел просто массив
      results = data.map((item: any) => ({
        id: item.id || '',
        title: item.title || '',
        url: item.url || item.images?.original?.url || '',
        preview: item.preview || item.url || '',
        width: item.width || 320,
        height: item.height || 180,
      }));
    }

    // Фильтруем пустые результаты
    results = results.filter((item: any) => item.url);

    console.log(`✅ Found ${results.length} GIFs`);

    return NextResponse.json({
      results: results.length > 0 ? results : getFallbackGifs().results,
      next: String(offset + limit),
      total: data.pagination?.total_count || data.total || results.length,
    });
    
  } catch (error) {
    console.error('💥 GIF API error:', error);
    return NextResponse.json(getFallbackGifs());
  }
}

// Fallback GIFs
function getFallbackGifs() {
  return {
    results: [
      {
        id: 'fallback-1',
        title: 'Hello',
        url: 'https://media.giphy.com/media/3o7aD2SAalBkft6NVG/giphy.gif',
        preview: 'https://media.giphy.com/media/3o7aD2SAalBkft6NVG/giphy.gif',
        width: 480,
        height: 270,
      },
      {
        id: 'fallback-2',
        title: 'Cool',
        url: 'https://media.giphy.com/media/3o6Ztqnj1hYhTfL9jO/giphy.gif',
        preview: 'https://media.giphy.com/media/3o6Ztqnj1hYhTfL9jO/giphy.gif',
        width: 480,
        height: 270,
      },
      {
        id: 'fallback-3',
        title: 'Funny',
        url: 'https://media.giphy.com/media/l0HlNQ5JZLx3kYlKo/giphy.gif',
        preview: 'https://media.giphy.com/media/l0HlNQ5JZLx3kYlKo/giphy.gif',
        width: 480,
        height: 270,
      },
    ],
    next: '',
    total: 3,
  };
}