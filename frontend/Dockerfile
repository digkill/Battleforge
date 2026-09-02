FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# По умолчанию пусто — фронтенд ходит на тот же origin, а nginx этого же образа
# проксирует /api на backend. Благодаря этому адрес бэкенда не вшивается в бандл
# и образ не нужно пересобирать при смене домена.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
