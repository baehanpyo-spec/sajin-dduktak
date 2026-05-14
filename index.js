const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
app.use(express.json());

// R2 클라이언트 (환경변수가 설정된 경우에만 초기화)
const r2 = process.env.R2_ACCOUNT_ID
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

// R2 미설정 시 임시 메모리 캐시 (10분 보관)
const imageCache = new Map();

async function storeImage(buffer) {
  const filename = `${uuidv4()}.png`;

  if (r2) {
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: filename,
        Body: buffer,
        ContentType: 'image/png',
      })
    );
    return `${process.env.R2_PUBLIC_URL}/${filename}`;
  }

  // R2 미설정: 메모리 캐시 + 로컬 서빙
  const id = uuidv4();
  imageCache.set(id, buffer);
  setTimeout(() => imageCache.delete(id), 10 * 60 * 1000);

  const host = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${process.env.PORT || 3000}`;

  return `${host}/result/${id}`;
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>사진뚝딱 - AI 배경 제거 서비스</title>
      <style>
        body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
        .company { color: #888; font-size: 14px; margin-top: 60px; border-top: 1px solid #eee; padding-top: 20px; }
      </style>
    </head>
    <body>
      <h1>📸 사진뚝딱</h1>
      <p>카카오톡 채널 <strong>@사진뚝딱</strong>에서 이용하실 수 있는 AI 배경 자동 제거 서비스입니다.</p>
      <h2>서비스 소개</h2>
      <ul>
        <li>카카오톡 채널에 사진을 보내면 배경이 자동으로 제거됩니다</li>
        <li>별도 앱 설치 없이 카카오톡에서 바로 이용 가능</li>
        <li>AI 기반 고품질 배경 제거 기술 적용</li>
      </ul>
      <h2>이용 방법</h2>
      <ol>
        <li>카카오톡에서 <strong>사진뚝딱</strong> 채널 추가</li>
        <li>배경을 제거할 사진 전송</li>
        <li>배경이 제거된 사진 즉시 수령</li>
      </ol>
      <div class="company">
        <p><strong>운영사:</strong> 주식회사 디트릭스</p>
        <p><strong>사업자등록번호:</strong> 257-88-00735</p>
        <p><strong>대표자:</strong> 오문준</p>
        <p><strong>소재지:</strong> 경기도 성남시 분당구 판교역로192번길 16, 701호</p>
      </div>
    </body>
    </html>
  `);
});

// 임시 이미지 제공 엔드포인트 (R2 미설정 시 사용)
app.get('/result/:id', (req, res) => {
  const buf = imageCache.get(req.params.id);
  if (!buf) return res.status(404).send('이미지를 찾을 수 없습니다.');
  res.set('Content-Type', 'image/png');
  res.send(buf);
});

app.post('/skill', async (req, res) => {
  console.log('API KEY:', process.env.REMOVE_BG_API_KEY ? '있음' : '없음');
  console.log('req.body:', JSON.stringify(req.body, null, 2));
  const body = req.body;

  // 카카오 오픈빌더 이미지 URL 추출
  const imageUrl =
    body?.userRequest?.params?.media?.url ||
    body?.action?.params?.media?.url;

  if (!imageUrl) {
    return res.json({
      version: '2.0',
      template: {
        outputs: [
          { simpleText: { text: '사진을 보내주세요! 배경을 제거해드릴게요 🖼️' } },
        ],
      },
    });
  }

  if (!process.env.REMOVE_BG_API_KEY) {
    console.error('REMOVE_BG_API_KEY 환경변수가 설정되지 않았습니다.');
    return res.json({
      version: '2.0',
      template: {
        outputs: [{ simpleText: { text: '서버 설정 오류: API 키가 없습니다.' } }],
      },
    });
  }

  try {
    // Remove.bg API 호출
    const form = new FormData();
    form.append('image_url', imageUrl);
    form.append('size', 'auto');

    const { data } = await axios.post(
      'https://api.remove.bg/v1.0/removebg',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'X-Api-Key': process.env.REMOVE_BG_API_KEY,
        },
        responseType: 'arraybuffer',
      }
    );

    const buffer = Buffer.from(data);
    const resultUrl = await storeImage(buffer);

    res.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleImage: {
              imageUrl: resultUrl,
              altText: '배경이 제거된 이미지',
            },
          },
          {
            simpleText: {
              text: '✅ 배경 제거 완료!\n아래 이미지를 꾹 눌러서 저장하세요.',
            },
          },
        ],
      },
    });
  } catch (error) {
    const errMsg = error.response?.data
      ? Buffer.from(error.response.data).toString()
      : error.message;
    console.error('오류:', errMsg);

    res.json({
      version: '2.0',
      template: {
        outputs: [
          { simpleText: { text: '❌ 배경 제거 중 오류가 발생했습니다. 다시 시도해주세요.' } },
        ],
      },
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
