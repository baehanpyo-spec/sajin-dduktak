const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.send('사진뚝딱 서버 작동 중!');
});

app.post('/skill', (req, res) => {
  res.json({
    version: '2.0',
    template: {
      outputs: [
        {
          simpleText: {
            text: '안녕하세요! 사진을 보내주세요.',
          },
        },
      ],
    },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
