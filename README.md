# 🌾 MazaoPlus: Agri-Fintech Ecosystem

![MazaoPlus Hero Banner](client/public/vite.svg)

MazaoPlus is an autonomous Agri-Fintech ecosystem that bridges physical agricultural logistics with high-speed digital finance. It empowers smallholder farmers by turning their physical harvest into liquid, digital financial assets.

---

## 📖 Table of Contents
1. [The Problem](#the-problem)
2. [Our Solution](#our-solution)
3. [Who It Serves](#who-it-serves)
4. [Demo Video & Features Walkthrough](#demo-video--features-walkthrough)
5. [Technical Architecture](#technical-architecture)
6. [Getting Started](#getting-started)

---

## 🚨 The Problem
In emerging markets like Kenya, smallholder farmers face a paradox: they produce valuable agricultural commodities but remain financially excluded. Lacking traditional collateral (like title deeds), they cannot access formal bank loans. 

As a result, farmers are often forced into **distress selling**—liquidating their harvest immediately at peak supply when market prices are at their lowest—just to meet immediate cash needs like school fees or farm inputs. 

## 💡 Our Solution
MazaoPlus solves this by digitizing the harvest. 

When a farmer deposits physical grain at a cooperative warehouse, the warehouse manager uses the MazaoPlus Admin Portal to log the deposit. The system instantly mints a digital **Produce Receipt** on an immutable ledger. This digital receipt serves as verifiable collateral. 

With this receipt, farmers can:
1. **Access Instant Credit:** Instantly draw a cash advance (up to 60% of the grain's current market value) disbursed directly to their M-Pesa mobile wallets.
2. **Execute Smart Contracts:** Set "Smart Sell Targets" on their receipts. An autonomous background agent monitors live commodity markets and automatically liquidates the grain when the price hits the farmer's target, settling the loan and remitting the profit to the farmer.

## 🤝 Who It Serves
1. **Smallholder Farmers:** Specifically those without smartphones. By integrating a fully-featured offline USSD simulator (`*483*1#`), farmers can check market prices, apply for cash advances, and set sell targets using basic feature phones.
2. **Cooperative & Warehouse Managers:** The platform provides a robust Admin Dashboard to monitor incoming deposits, system-wide liability, physical commodity stock, and real-time Loan-to-Value (LTV) platform health.

---

## 🎥 Demo Video & Features Walkthrough
[Mazao](https://youtu.be/q2xaYkl9fj4)

Our Hack Day demo video showcases the end-to-end journey of a bag of Maize entering the MazaoPlus ecosystem. The video highlights:

1. **The Warehouse Admin Portal:** Watch as the warehouse manager logs a new physical deposit. The system instantly mints a digital receipt and dynamically updates the platform's Liability Heatmap and Commodity Stock grid in real-time.
2. **The USSD Feature-Phone Flow:** We demonstrate our bespoke USSD Simulator (`*483*1#`). You will see a farmer checking their live credit score, viewing their available digital receipts, and requesting a custom Cash Advance that is instantly "disbursed" to M-Pesa.
3. **The Farmer Dashboard (Web):** A beautiful, responsive React dashboard where farmers can view live streaming market prices (updated via SSE), check their animated Wallet Balance, and configure Smart Sell Targets.
4. **The Autonomous Market Agent:** The video shows the background Go routine autonomously fluctuating crop prices. Once a price spikes and hits a farmer's target, the agent executes the sale, settles the active loan, and credits the remaining profit directly to the farmer's wallet—all without human intervention.

---

## ⚙️ Technical Architecture

To achieve maximum performance, ease of deployment, and absolute data consistency, MazaoPlus is architected as a monolithic, high-speed single binary.

### Core Architecture
- **Language:** Written in Go (Golang), taking advantage of its profound concurrency model.
- **In-Memory Ledger:** Bypasses the latency of traditional SQL databases by using an in-memory `Store` protected by highly optimized `sync.RWMutex` locks. This allows the system to process micro-transactions and price checks in microseconds.
- **Autonomous Agent:** A persistent Go routine runs in the background, simulating a live commodity market. It fluctuates prices based on market volatility algorithms and executes "Smart Sell" contracts automatically when thresholds are breached.
- **Embedded Frontend:** The rich, interactive React (Vite/TypeScript) SPA is compiled and embedded directly into the Go binary via `embed.FS`. The entire application—API, Web UI, USSD Simulator, and Autonomous Agent—runs from a single executable file.

### Key Technical Implementations
1. **Real-time Synchronization:** The frontend utilizes Server-Sent Events (SSE) to receive live, sub-second market price updates pushed by the Go backend.
2. **Optimistic UI Updates:** The React application utilizes optimistic state management to instantly reflect changes (like wallet balances and receipt status) to the user, masking any network latency and providing a premium "zero-latency" feel.
3. **Kilimo Credit Scoring:** A dynamic algorithm evaluates the farmer's history (tenure and successful loan settlements) to assign a credit score (0-1000) and tier (Bronze to Platinum), which dictates their loan limits.
4. **USSD Emulation:** A custom-built state machine safely parses and resolves USSD path navigation (including standard `0` for Back and `00` for Home), allowing seamless testing of feature-phone flows on the web.

---

## 🚀 Getting Started

Because MazaoPlus is bundled as a single Go binary, running it locally is incredibly simple.

### Prerequisites
- Go 1.21+
- Node.js & npm (for building the React frontend)

### Build & Run
1. **Clone the repository**
   ```bash
   git clone https://github.com/eric-kaloki/mazao.gitt
   cd mazaoplus
   ```

2. **Build the Frontend & Backend**
   We have provided a Makefile to compile the Vite React app and embed it into the Go binary.
   ```bash
   make build
   ```

3. **Run the Application**
   ```bash
   ./mazaoplus
   ```

4. **Access the Portal**
   Open your browser and navigate to `http://localhost:8080`.
   - **Warehouse Manager:** Use the Admin Portal tab to log deposits.
   - **Farmer Web Portal:** Log in with National ID `12345678` or `87654321`.
   - **USSD Simulator:** Navigate to the USSD tab and use the on-screen keypad to dial `*483*1#`.
