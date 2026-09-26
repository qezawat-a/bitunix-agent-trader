# Bitunix AI Agent Trader (JavaScript)

In repo yek **AI Agent Trader agentic** baraye Bitunix USDT-M Futures ast; robot-e sade nist. Agent mitavanad ba LLM fekr konad, tool seda bezanad, market/account/position ro check konad, az Neon memory estefade konad, va az Telegram ba karبر chat konad. Exchange adapter faghat bar اساس docs-e rasmi Bitunix neveshte mishavad.

## وضعیت فعلی

In version **foundation-e executable** ast: authentication/signing, typed exchange boundary, Neon persistence, strategy scanner, risk gates, agent tool loop, soul/skills, Telegram routing, health endpoint va tests ra فراهم mikonad. Baraye live order, do activation gate lazem ast: `LIVE_TRADING=1` va `ARM_TRADING=1`. Default `0` ast. In dry-run simulator nist; ta vaghti arm nashode, order write reject mishavad.

Report scheduler مستقل از scan loop اجرا می‌شود و report را واقعاً با `sendMessage` به Telegram می‌فرستد. مقصد به‌ترتیب از `telegramChatId` ذخیره‌شده، `TELEGRAM_CHAT_ID` و در نهایت `TELEGRAM_USER_ID` انتخاب می‌شود. اگر `TELEGRAM_CHAT_ID` خالی باشد، اولین `/start` یا پیام کاربر مجاز، `ctx.chat.id` را persist می‌کند. خطاهای ارسال با stack/message در log و storage ثبت می‌شوند و شکست یک report، timer را متوقف نمی‌کند.

هر report شامل این بخش‌هاست: **Bot / trading status** (وضعیت arm، live trading، kill switch، auto-trade، scan/report و تنظیمات نماد)، **Current signal** (آخرین signal ذخیره‌شده از scanner به‌همراه direction، confidence و زمان ثبت)، و **Open position / PnL** (positionهای باز از `get_pending_positions` با side، size، entry، mark و فیلد واقعی PnL). اگر signal ثبت نشده باشد `No signal recorded yet` و اگر position باز نباشد `No open position. PnL: not applicable.` نمایش داده می‌شود؛ هیچ placeholder عددی ساخته نمی‌شود.

## Live price lookup

`/price RAREUSDT` و `/ticker RAREUSDT` مستقیماً از Bitunix می‌خوانند. قیمت آخر از `GET /api/v1/futures/market/tickers?symbols=RAREUSDT` و بهترین bid/ask از `GET /api/v1/futures/market/depth?symbol=RAREUSDT&limit=5` می‌آید. پرسش‌های free-text شامل `price`، `ticker` یا «قیمت» نیز قبل از ارسال به LLM به همین مسیر deterministic می‌روند؛ ابزار `market_ticker` داخل agent هم همین الزام را دارد. پاسخ شامل symbol، bid، ask، last، timestamp محلی دریافت و source endpointهاست. اگر ticker fail شود یا داده‌ای برای symbol برنگردد، خطای واقعی sanitize‌شده نمایش داده می‌شود؛ اگر depth fail شود، last واقعی حفظ و bid/ask به‌عنوان unavailable گزارش می‌شود. قیمت هرگز از order history یا حافظهٔ مدل حدس زده نمی‌شود.

Baraye release-e final-e live, phase-e baadi lazem ast: private/public WebSocket subscription ba reconnect/heartbeat, reconcile-e کامل order/position, dynamic ATR TP/SL + breakeven/trailing manager, MCP server registry, multi-provider auto-switch, va verification-e endpoint fields ba account-e Bitunix. In deliverable عمداً in موارد ro ادعا-نشده نگه داشته تا رفتار حدسی وارد trading نشavad.

## Run

```bash
cp .env.example .env
npm install
npm run db:init
npm test
npm start
```

Telegram token, user ID, Neon URL, LLM credential va Bitunix keys ro faghat dar secret manager ya `.env` local bezarid; hich secret-i commit nakonid.

## Telegram commands

`/start`, `/help`, `/status`, `/settings`, `/balance`, `/signal`, `/positions`, `/orders`, `/history`, `/scan_on`, `/scan_off`, `/report_on`, `/report_off`, `/auto_trade`, `/pause`, `/kill_switch`, `/set <key> <value>`.

Chat-e adi ham be agent mire. Agent bayad baraye action-haye risk-dar tool-e مشخص va policy ro رعایت کند.

`/tset` نیز به‌عنوان alias برای `/set` ثبت شده است؛ پیام `Unknown command` قبلی به این دلیل بود که commandهای README در کد ثبت نشده بودند. `/start` و `/help` اکنون فهرست کامل commandها را نشان می‌دهند.

## LLM troubleshooting

برای providerهای OpenAI-compatible از `OPENAI_COMPATIBLE_KEY` و `OPENAI_COMPATIBLE_URL` استفاده کنید. نام‌های `OPENAI_API_KEY`، `OPENAI_BASE_URL` و `OPENAI_MODEL` نیز پذیرفته می‌شوند و typo قدیمی `OPENAI_COMPATIBALE_MODEL` هم برای سازگاری خوانده می‌شود. وقتی مدل `AUTO` باشد، برنامه ابتدا `/models` را امتحان می‌کند و اگر provider آن endpoint را نداشت، از `gpt-4o-mini` استفاده می‌کند. خطای شبکه، timeout، HTTP status و پیام provider اکنون جداگانه گزارش می‌شوند؛ بنابراین `fetch failed` مبهم باقی نمی‌ماند.

## Default trading policy

| Policy | مقدار |
|---|---:|
| Scan / guard / mid-manager | 15s |
| Report | 30s |
| Min agreement | 2 strategy |
| Min confidence | 80% |
| TF min confidence | 60% |
| Confirm scans | 1 |
| Cooldown | 5 min |
| Reversal | enabled, confidence 85% |
| TP/SL | dynamic ATR + signal strength; no static min/max settings |
| Position mode | hedge |
| Margin mode | isolated |

In defaults recommendation hastand, na guarantee-e سود. AI mitavanad signal ro reject کند; code deterministic risk gates ra bypass nemikonad.

## Official Bitunix sources

- [API introduction](https://www.bitunix.com/api-docs/futures/common/introduction.html)
- [Signature](https://www.bitunix.com/api-docs/futures/common/sign.html)
- [Place order](https://www.bitunix.com/api-docs/futures/trade/place_order.html)
- [WebSocket](https://www.bitunix.com/api-docs/futures/websocket/prepare/WebSocket.html)
- [Bitunix OpenAPI repository](https://github.com/BitunixOfficial/open-api)

## Hosting

Baraye 24/7 Telegram + WebSocket + 15-second loops, service bayad ro host-e always-on ejra shavad. WebDev Reserved hosting baraye Node process-e سبک momken ast; VPS/cloud computer control-e bishtari baraye firewall/systemd mide. Neon state ro persistent mikonad, vali deployment bayad restart-safe va reconciliation داشته باشد.

## Important

Live futures trading risk-e واقعی darad; liquid شدن, slippage, API outage va مدل اشتباه momken ast. Ghabl az arm kardan, API key ro withdrawal permission nadahid, symbol/position mode/leverage ro check konid, va kill switch ro test konid.
