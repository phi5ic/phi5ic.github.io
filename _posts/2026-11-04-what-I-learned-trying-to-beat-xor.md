---
title: "What I Learned Trying to Beat XOR"
date: 2026-11-04
excerpt: "Can XOR be beaten in erasure-coded storage? An investigation into scalar vs array codes, slice-level repair, and benchmark results comparing Sliced HADR-v2 against monolithic XOR."
header:
  teaser: /assets/images/posts/nifsi-cluster-status.jpg
categories:
  - storage
  - coding-theory
  - distributed-systems
tags:
  - erasure-coding
  - xor
  - nifsi
  - storage
use_math: true
---

## Why I started

I think the best way to learn something is to go straight into the deep end with no prerequisite knowledge and see what happens. Most of my favorite learning came from that. I hate my college coursework and exams (which are insanely repetitive, boring, and draggy), so I've found that putting myself through masochistic technical hardships is a much better learning pathway for someone like me.

I was working on my ongoing project, Nifsi (a distributed userspace OS layer on top of Linux, currently targeting 10 to 50 nodes), when I hit the storage distribution problem. I needed something fast, versatile, and able to recover chunks without crying when a node drops. That's when I ran into XOR and what it does for erasure coding.

Naturally, instead of just using a normal library like a sane person, my curiosity got the best of me:

> **Can XOR be beaten in erasure-coded storage?**

While that sounds like a quick afternoon Google search, I can assure you it's anything but. I used LLMs (Gemini, DeepSeek, Qwen) to bounce ideas around and locate papers, mostly treating their outputs as suspect hypotheses to verify against actual coding theory and code. Left unchecked, they will happily hallucinate and drift into pure science fiction.

## What XOR actually guarantees

In erasure-coded storage, XOR-based MDS array codes like Liberation, STAR, and the RAID-6 family are everywhere. They are fast because XOR maps directly to dirt-cheap CPU instructions that vectorize well, and they are simple because decoding is just linear algebra over $GF(2)$.

The big distinction—which, truth be told, I got completely wrong at first—is between **scalar codes** and **array codes**.

A scalar linear code over $GF(2)$ with multiple data and parity symbols has essentially no useful MDS constructions. The binary alphabet is just too small and restrictive (with trivial exceptions like repetition and single-parity codes). That is the real reason you don't see "binary Reed-Solomon" in the wild.

Array codes cheat this limit by changing the model. Each storage symbol is treated as a **column of bits**, not a single field element. Parity equations operate on these bit vectors using XOR alongside carefully chosen shifts and permutations. That extra structure is how EVENODD, RDP, Liberation, and STAR pull off 2- or 3-failure recovery using nothing but XOR. XOR doesn't magically become MDS over $GF(2)$; the coding model just changes the rules of the game.

Understanding this matters for the rest of the post, because it's the only reason pure-XOR storage codes exist at all.

## What the alternatives actually change

Still stubbornly trying to see if the primitive itself could be replaced, I poked around a few different mathematical rabbit holes.

**Complex and imaginary arithmetic.** Floating-point complex math isn't bit-exact, and storage recovery doesn't forgive rounding errors. Even if you use fixed-point, complex symbols double your storage footprint (real + imaginary parts), and complex multiplication takes several operations instead of a single instruction. Dead on arrival for the hot path.

**Finite field extensions.** $GF(2^m)$ is home turf for Reed-Solomon. Here is a major correction to my own earlier misconception: **addition over $GF(2^m)$ is still just bitwise XOR.** There is no carry. The actual tax of a larger field shows up in **multiplication**. You can speed that up with lookup tables, carry-less multiply instructions (`PCLMULQDQ`), or bit-matrix XORs (Cauchy Reed-Solomon), but it is still way more work per byte than pure XOR array codes. RS isn't slower because addition carries; it's slower on the hot path because multiplication and matrix inversion hurt.

**Non-linear codes.** A few non-linear constructions have decent encoders or decoders, but most don't, especially for the arbitrary erasure patterns storage systems care about. I didn't find anything here that credibly beat binary array codes for my workload (though that's just a statement about what I looked at, not a mathematical proof).

A conversation with Akari Hayami, a researcher in formal verification I found on LinkedIn, finally helped me untangle two questions I had been mashing together: whether XOR is *mathematically necessary* for chunk regeneration, and whether it's simply the *fastest practical choice* on modern silicon. Akari pointed out that XOR is just addition in characteristic 2, and systems use it because hardware loves it, not because the algebra forces you to. 

That reframed everything. I wasn't fighting XOR anymore; I was fighting the cost of addition and multiplication on the hot path.

## The real bottleneck isn't a single bottleneck

The biggest takeaway from bashing my head against the math is that "beating XOR" was a dumb question to begin with. Erasure-coded storage has at least three separate cost problems, and the CPU instruction is only one piece of the puzzle.

**Encoding cost.** This comes down to instruction count, memory traffic, and cache locality. A fancy code that uses fewer XOR operations isn't going to run any faster if your CPU is just sitting there waiting on RAM. For large stripes, encoding is almost always memory-bandwidth-bound, not compute-bound.

**Decoding and repair cost.** This depends on which fragments survive, how many bytes you have to pull off surviving disks, and how much garbage you have to shove across the network to fix one dead node. A standard XOR MDS code reads $k$ surviving chunks just to repair a single failure. That is brutal on network traffic, and the cut-set bound proves you don't actually have to read that much. Local Reconstruction Codes (LRCs) and regenerating codes trade a bit of extra storage or field complexity to make repairs much cheaper.

**Update and write amplification.** If you overwrite a tiny piece of a data fragment, you also have to update every parity fragment that depends on it. Full-stripe writes dodge this, but partial-stripe updates force nasty read-modify-write cycles.

You don't get a free lunch here. Tweaking a code to fix one of these usually makes another one worse. XOR is almost always the right tool for raw encoding speed, and almost never the whole answer for network repair.

## What this means for Nifsi

Once I accepted that I didn't need to reinvent binary addition, the actual goal became clear: keep XOR where it dominates, and fix the repair and update bottlenecks structurally.

My current design splits the problem into four parts. **To keep myself honest about what actually exists right now: Part 1 is partially built, Parts 2 and 3 are working prototypes, and Part 4 is still on the drawing board.**

**1. Encoding (partially implemented).** Stick with a battle-tested binary array code for raw chunk encoding and optimize the memory layout before trying to be clever. I'm measuring throughput, CPU cycles per byte, and memory bandwidth separately to see where the hardware actually chokes.

**2. Repair (implemented prototype).** Instead of pulling entire multi-megabyte chunks across the network when something breaks, I built a prototype around **slice-level repair**. Every fragment is chopped into independently addressable 4 KB slices, using **horizontal and diagonal parity** across those slices:

<figure>
  <img src="/assets/images/posts/nifsi-inspect-strand.jpg" alt="Nifsi file strand inspection terminal output">
  <figcaption>Inspecting file strand integrity and 4 KB slice allocation using <code>nifsi inspect</code>.</figcaption>
</figure>

<figure>
  <img src="/assets/images/posts/nifsi-slice-query.jpg" alt="Nifsi sub-packet slice query terminal output">
  <figcaption>Querying sub-packet slices within a chunk using <code>nifsi slice-query</code>.</figcaption>
</figure>

$$
P_h[s] = \bigoplus_{i=0}^{k-1} D_i[s]
$$

$$
P_d[s] = \bigoplus_{i=0}^{k-1} D_i[(s + i) \bmod M]
$$

Mathematically, this is just standard diagonal array parity (same family as RDP and EVENODD), applied at 4 KB slice granularity. When a slice gets corrupted, the repair engine tracks it down via a Merkle tree, pulls only the required diagonal/horizontal slices, patches the 4 KB hole, and moves on. Internally I've been calling this guided lookup-and-patch flow "CRISPR/Cas homology repair" because I like the biological metaphor, though under the hood it's pure array-code math and Merkle trees.

<figure>
  <img src="/assets/images/posts/nifsi-crispr-repair-slice.jpg" alt="Nifsi slice repair execution showing bit-for-bit reconstruction">
  <figcaption>Targeted slice repair in action: repairing a single 4 KB slice bit-for-bit with <code>nifsi repair-slice</code> without touching the rest of the chunk.</figcaption>
</figure>

**3. Updates (implemented prototype).** To stop small writes from tanking the system, I used delta journaling. When a 4 KB slice changes, you XOR the old and new slice ($\Delta = D_i^{\text{old}}[s] \oplus D_i^{\text{new}}[s]$) and ship that delta straight to the parity nodes:

$$
P_h^{\text{new}}[s] = P_h^{\text{old}}[s] \oplus \Delta
$$

$$
P_d^{\text{new}}[(s - i) \bmod M] = P_d^{\text{old}}[(s - i) \bmod M] \oplus \Delta
$$

No reading surviving data nodes just to recalculate parity. In the benchmarks, this locked write amplification at a flat **3.0×**, regardless of how big the chunk gets. Monolithic XOR hit 16,384× on 16 MB chunks.

**4. Integrity (separate project).** Detecting bit-rot, authenticating versions, and reaching Byzantine consensus on metadata are three completely separate headaches. Right now I'm sticking to per-fragment hashes and version checks. I'm not touching BFT metadata unless the threat model actually forces my hand.

## What the benchmark showed

I pitted the prototype (**Sliced HADR-v2**) against two baselines: **Monolithic XOR** (whole-chunk parity, which is what Nifsi-v1 currently runs) and **Cauchy Reed–Solomon** over $GF(2^8)$ with $k=4, p=2$. Chunk sizes scaled from 64 KB up to 16 MB.

### Repair network transfer

| Chunk size | Monolithic XOR | Sliced HADR-v2 | Reed–Solomon |
|---|---|---|---|
| 64 KB | 256 KB | **16 KB** | 256 KB |
| 256 KB | 1024 KB | **16 KB** | 1024 KB |
| 1 MB | 4096 KB | **16 KB** | 4096 KB |
| 16 MB | 65536 KB | **16 KB** | 65536 KB |

Sliced HADR-v2 sits at a flat **16 KB** across the board—just the 4 KB slices needed plus packet framing. Monolithic XOR and RS scale linearly and painfully with chunk size. At 16 MB, the sliced prototype moves **1/4096th** of the data over the wire because it refuses to rebuild the whole 16 MB block for a localized fault.

### Write amplification

| Chunk size | Monolithic XOR | Sliced HADR-v2 | Reed–Solomon |
|---|---|---|---|
| 64 KB | 64× | **3×** | 96× |
| 256 KB | 256× | **3×** | 384× |
| 1 MB | 1024× | **3×** | 1536× |
| 16 MB | 16384× | **3×** | 24576× |

Delta journaling holds write amplification at 3.0× no matter how huge the underlying chunk is. There's no magic tuning here; it's just the math of updating a 4 KB delta instead of rewriting an entire block.

### The ugly truth: encode throughput

| Chunk size | Monolithic XOR | Sliced HADR-v2 | Reed–Solomon |
|---|---|---|---|
| 64 KB | 14.96 GB/s | **0.82 GB/s** | 0.71 GB/s |
| 256 KB | 37.18 GB/s | **0.95 GB/s** | 0.63 GB/s |
| 1 MB | 25.44 GB/s | **0.72 GB/s** | 0.41 GB/s |
| 16 MB | 12.89 GB/s | **0.94 GB/s** | 0.67 GB/s |

Here is the reality check: **Sliced HADR-v2 encodes at 0.72–0.95 GB/s, making it 15 to 50× slower than Monolithic XOR.** 

If I were trying to sell you Sliced HADR-v2 as a drop-in replacement for XOR, this table would kill my argument on the spot. Instead, it proves why you can't use a single hammer for every nail. Slicing, Merkle hashing, and diagonal indexing add massive overhead during initial ingestion. Sliced HADR-v2 is great at surgical repairs, and terrible at bulk writes. Monolithic XOR screams through bulk writes, and chokes on repairs. You need both.

### Distributed cluster test

To make sure this wasn't just working in a sterile microbenchmark, I threw it at a messy local cluster setup:

<figure>
  <img src="/assets/images/posts/nifsi-cluster-status.jpg" alt="Nifsi cluster status terminal output">
  <figcaption>Live Nifsi cluster status showing consensus term leadership, active HADR chunks, and connected mesh peers.</figcaption>
</figure>

- 4 virtual consensus nodes on my laptop + 1 physical Raspberry Pi 3B+ over Wi-Fi (ARM Cortex-A53 + an Arduino Uno R4 / Renesas RA4M1 hooked up for hardware state output).
- 50 files dumped in concurrently (22.11 MB total), with 46/50 verified bit-for-bit on the secondary mount.
- 100 random partial writes finished in 0.016 s (6,370 ops/sec), all SHA-256 verified.
- Fired an ungraceful `SIGKILL` at `vnode3` mid-write: the surviving 3/4 quorum finished the write in 0.010 s and resynced cleanly once the node came back.
- All 5 test files pushed to the Raspberry Pi verified bit-for-bit across the wireless mesh.

### Where the benchmark is still sketchy

I want to be upfront about the flaws in my current testing setup before anyone takes these numbers as gospel:

- **The 4-node mesh is running locally on one machine.** When the table says "16 KB network transfer," that's the payload size the storage engine ships over local sockets, not packets fighting over a physical switch. Running this across four separate physical boxes is next on the list.
- **The latency numbers are weird.** My degraded read p50 latencies bounced around non-monotonically (4.08 µs at 64 KB, jumping to 11.55 µs at 4 MB, then dropping right back to 4.08 µs at 16 MB). That tells me I'm mostly measuring syscall or mutex overhead rather than per-byte reconstruction time. I trust the bandwidth and WAF numbers because those are structural, but the latency timer needs a rewrite.
- **One Pi over Wi-Fi isn't a real LAN stress test.** It proves the Rust code compiles and runs cleanly on ARM without corrupting bits, not that the network layer is production-ready.

## What I got out of this

I jumped into this trying to outsmart a basic bitwise operator. Unsurprisingly, XOR won the raw speed fight. 

What I actually learned is that obsessing over the lowest-level primitive is a trap. Once your XOR loop is vectorized, the CPU isn't your problem anymore—memory bandwidth, network repair traffic, and write amplification are. Monolithic XOR destroys my sliced codec on bulk encoding by up to 50×. My sliced codec destroys Monolithic XOR on repair traffic by 4096× and write amplification by 5461×. Neither one can do the other's job.

If I had written this post two weeks ago, I probably would have embarrassed myself claiming I invented a magic replacement for XOR. Actually writing the code, watching the encode numbers tank, and figuring out *why* they tanked was worth way more than any textbook chapter I've zoned out of in college.

## What's next

The benchmark basically wrote my roadmap for me. The next move for Nifsi is wiring up a hybrid engine that uses both paths:

- **Hot write path:** Dump incoming full-stripe writes through Monolithic XOR at 12–37 GB/s so ingestion doesn't bottleneck.
- **Background & repair path:** Index chunks into 4 KB slices with Merkle trees so degraded reads and node repairs only pull 16 KB over the network.
- **Small overwrites:** Route random partial updates through the delta journal to keep write amplification pinned at 3.0×.
- **Better benchmarking:** Put this on real multi-node LAN hardware, fix the latency harness so it stops measuring mutex locks, and benchmark directly against a standard C implementation of Liberation or RDP.

If you spend your free time messing with erasure coding, FUSE filesystems, or distributed storage on LAN clusters, I'd love to compare notes. 

I still don't know where this project ends, which is the whole point of building it.

## Benchmark code and artifacts

**[nifsi-benchmarks on GitHub](https://github.com/phi5ic/Nifsi/tree/main/benchmarks)**

*Full disclosure: The benchmark harness scripts were generated with Gemini Flash 3.8 so I could spend my time on the storage engine instead of boilerplate.*

The repo has the harness (`bench/`), raw JSON dumps (`results/benchmark_results.json`), the longer write-up (`results/BENCHMARK_SCIENTIFIC_REPORT.md`), and the chaos/kill scripts (`scripts/`). The commit hash for the exact run in the tables above is `REPLACE_WITH_COMMIT_HASH`.

If you find bugs, cursed math, or non-reproducible results, open an issue and roast me there.
