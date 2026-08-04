FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SITE_URL=https://email-hosting.kmerhosting.com
ARG VITE_DOMAIN_STORE_URL=https://domain.kmerhosting.com
ARG VITE_SUPPORT_EMAIL=support@kmerhosting.com
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SITE_URL=$VITE_SITE_URL
ENV VITE_DOMAIN_STORE_URL=$VITE_DOMAIN_STORE_URL
ENV VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
