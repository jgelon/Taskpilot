FROM node:20-alpine AS builder
WORKDIR /app

ARG AUTHENTIK_URL
ARG OIDC_CLIENT_ID
ARG APP_URL

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Inject runtime values into the production environment file
RUN sed -i "s|https://auth.your-domain.com|${AUTHENTIK_URL}|g" src/environments/environment.prod.ts && \
    sed -i "s|YOUR_CLIENT_ID|${OIDC_CLIENT_ID}|g" src/environments/environment.prod.ts && \
    sed -i "s|https://your-app-domain.com|${APP_URL}|g" src/environments/environment.prod.ts

RUN npm run build -- --configuration=production

FROM nginx:alpine
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
