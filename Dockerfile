FROM node:20-alpine AS builder
WORKDIR /app
# nodejieba native addon requires python3, make, g++ to compile C++ bindings
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY prisma ./prisma/ 
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# nodejieba compiled .node addon requires libstdc++ at runtime on Alpine
RUN apk add --no-cache libstdc++
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma/

EXPOSE 10000

# 啟動時先跑 migrate deploy，再跑 NestJS
CMD ["npm", "run", "start:prod"]