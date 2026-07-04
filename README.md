# 🐙 Kraken

Chat offline em malha (mesh) para lugares sem internet — como um WhatsApp que
funciona sem operadora, sem WiFi com internet e sem servidor central.

Parte do ecossistema **Oceano Livre**.

## Como funciona

Cada celular com o Kraken instalado é um **nó** da malha. Ele roda, dentro do
próprio app, um servidor local (Flask + Socket.IO em Python, embutido via
[Chaquopy](https://chaquo.com/chaquopy/)) que serve a interface de chat pra
quem estiver na mesma rede local — um roteador, o hotspot de um celular, ou
uma conexão Wi-Fi Direct pareada manualmente. Pro sistema, todos esses casos
são só "uma rede IP local"; o Kraken não precisa saber qual é.

### Malha tolerante a atraso (sneakernet mesh)

Não existe servidor central. Cada nó guarda todas as mensagens localmente
(SQLite) e, sempre que descobre outro nó na mesma rede (via broadcast UDP),
sincroniza automaticamente tudo que um tem e o outro não (gossip/anti-entropia
via TCP). Isso significa que a rede funciona **mesmo que dois celulares nunca
estejam online ao mesmo tempo**: a mensagem "pega carona" de aparelho em
aparelho conforme as pessoas circulam entre diferentes redes/hotspots.

Só quem quiser ser um nó (guardar histórico, retransmitir) precisa instalar o
Kraken. Qualquer outra pessoa pode entrar só pelo navegador, sem instalar
nada, abrindo o endereço de um nó ou escaneando o QR code da tela "Convidar".

### O que já funciona (Fase 1)

- Chat de texto em tempo real entre todos os nós/navegadores conectados
- Envio de arquivos, fotos e áudio
- Convite por QR code / link direto
- PWA instalável (ícone na tela inicial, sem loja de apps)
- APK nativo Android (sem precisar de Termux), com:
  - Início automático ao ligar o celular
  - Roda em segundo plano (serviço em primeiro plano + wake lock)
  - Verificação de atualização automática via GitHub Releases

### Ainda não construído (Fase 2)

- Chamada de voz/vídeo em tempo real (exige nós-ponte online simultaneamente
  e uma arquitetura de roteamento completamente diferente da mesh de texto)
- Grupos privados/abertos e fórum de votação da comunidade

## Estrutura do projeto

```
kraken-chat/
├── app/src/main/
│   ├── java/br/com/oceanolivre/kraken/
│   │   ├── MainActivity.java       - WebView + tela principal
│   │   ├── KrakenService.java      - roda o servidor Python em 1º plano
│   │   ├── BootReceiver.java       - inicia sozinho quando o celular liga
│   │   └── UpdateChecker.java      - checa/baixa/instala versão nova
│   └── python/
│       ├── server.py               - servidor mesh (Flask + SocketIO)
│       ├── static/                 - CSS, JS, ícones, PWA
│       └── templates/index.html    - interface do chat
├── build.gradle, settings.gradle   - build Android (Gradle + Chaquopy)
└── local.properties                - caminho do Android SDK (não versionado)
```

## Rodando fora do Android (Termux / desktop)

O mesmo `server.py` roda direto com Python puro, sem Chaquopy nem Android:

```
pip install flask flask-socketio simple-websocket qrcode
python server.py
```

Abre em `http://<ip-do-aparelho>:5000/`.

## Build do APK

Requer Android SDK (`local.properties` apontando pra ele) e um Python local
3.10–3.14 pra servir de `buildPython` do Chaquopy (configurado em
`app/build.gradle`).

```
./gradlew assembleDebug
```

Gera `app/build/outputs/apk/debug/app-debug.apk`.

## Publicando uma atualização

O app verifica a última release do GitHub toda vez que abre. Pra publicar
uma nova versão:

1. Suba `versionCode` e `versionName` em `app/build.gradle`
2. `./gradlew assembleDebug`
3. `gh release create v<versionCode> app/build/outputs/apk/debug/app-debug.apk --title "vX" --notes "..."`

O `<versionCode>` na tag (`vN`) é o que o app compara pra saber se tem
atualização nova — por isso o nome da tag precisa ser exatamente `v` seguido
do número do `versionCode`.

## Créditos

Criado por **Nautilus the Salma**, parte do ecossistema Oceano Livre.
