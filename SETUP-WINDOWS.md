# Windows'da Avtodromni ishga tushirish

## 1. Kerak bo'ladi
- Windows 10/11
- Node.js 20 yoki undan yangi
- PostgreSQL/Neon `DATABASE_URL`

## 2. Birinchi marta
Repositoryni kompyuterga yuklang:

```text
git clone https://github.com/muxammadali20037-cell/avtodrom12.git
```

`backend/.env` faylini yarating va `DATABASE_URL`, `JWT_SECRET` hamda kerak bo'lsa `CORS_ORIGIN`ni kiriting.

## 3. Ishga tushirish
`start-avtodrom.bat` fayliga ikki marta bosing.

U backend kutubxonalarini o'rnatadi, serverni ishga tushiradi va brauzerda:

`http://localhost:3000`

manzilini ochadi.

Server oynasini yopmang. Ilovani to'xtatish uchun server oynasida `Ctrl+C` bosing.

## Muhim
`.env` faylini GitHub'ga yuklamang. Unda database ulanish ma'lumotlari va JWT secret bo'ladi.
