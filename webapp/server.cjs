const path = require('node:path');
const express = require('express');

const app = express();
const distDir = path.join(__dirname, '..', 'dist');

app.disable('x-powered-by');
app.use(express.static(distDir, { maxAge: '1h' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Web app listening on ${port}`);
});
