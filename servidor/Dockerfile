# Imagem do app. Roda na mesma rede do banco, então o Postgres continua sem
# porta publicada na máquina.
FROM node:20-alpine

# pg_dump e openssl para o backup cifrado
RUN apk add --no-cache postgresql16-client openssl

# Mesmo desenho de pastas do repositório (servidor/ ao lado de validacao/): o coletor e as
# rotas importam "../../validacao/...", então o servidor mora em /app/servidor.
WORKDIR /app/servidor

# Só o que o servidor precisa — o Playwright é de desenvolvimento e não entra.
COPY servidor/package.json servidor/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# O código do servidor e as telas (o gerador de página é compartilhado)
COPY servidor/src ./src
COPY servidor/criar-usuario.mjs ./criar-usuario.mjs
COPY servidor/migrar.mjs ./migrar.mjs
COPY servidor/migrations ./migrations
COPY servidor/scripts ./scripts
COPY validacao /app/validacao

ENV NODE_ENV=production
EXPOSE 3200
CMD ["node", "src/servidor.mjs"]
