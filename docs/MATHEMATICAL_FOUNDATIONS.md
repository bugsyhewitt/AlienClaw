# Mathematical Foundations of AlienClaw

This document provides the rigorous mathematical foundation underlying AlienClaw's architecture. It exists to support future architectural decisions — particularly the eventual Subagent genome layer (512-1024 char genomes) — with formal grounding rather than intuition.

The post-correction arc (Packets 14-28) established the Martian-level architecture empirically. This document establishes its mathematical foundation explicitly and projects forward to the Subagent regime that the Martian work was designed to scale toward.

## Notation

Throughout this document:

- $G$: a genome — a string in $\{0,1,\ldots,9,A,\ldots,Z,a,\ldots,z\}^L$ where $L$ is genome length in characters (Base62 encoding)
- $L_M = 256$: Martian genome length (4 slots × 64 chars)
- $L_S$: Subagent genome length, currently anticipated as $L_S \in \{512, 1024\}$ (8 or 16 slots × 64 chars)
- $k$: slot count of a composition Martian or Subagent
- $t$: total tool_calls used in a Martian's execution (sum across slots)
- $c \in [0,1]$: correctness, possibly per-slot or aggregated
- $f \in [0,1]$: fitness, the scalar objective of evolution
- $N$: effective population size for selection (currently $N=100$ for Martian populations)
- $s$: selection coefficient — the relative fitness advantage of a mutation
- $\mu$: per-Xcode mutation rate (~0.78% from Packet 15)
- $\alpha = 0.1$: the canonical fitness formula's penalty coefficient (Packet 28)
- $H(X)$: Shannon entropy of random variable $X$, in nats
- $I(X;Y)$: mutual information between $X$ and $Y$, in nats

## Part 1: The Martian Fitness Function

### 1.1 The Canonical Formula

The canonical Martian fitness function, as adopted in Packet 28:

$$
f(c, t, k) = c \cdot \frac{1}{1 + \alpha \cdot \max(0, t - k)}
$$

where $c$ is the aggregate correctness (min over slot correctnesses, per Packet 16), $t$ is the aggregate tool_calls (sum over slots), $k$ is the slot count, and $\alpha = 0.1$.

The aggregate correctness rule:
$$
c = \min_{i \in \{1,\ldots,k\}} c_i
$$

The aggregate tool_calls rule:
$$
t = \sum_{i=1}^{k} t_i
$$

### 1.2 Mathematical Properties

**Property 1 (Range).** $f(c, t, k) \in [0, 1]$ for all valid inputs.

*Proof.* The penalty term satisfies $1/(1 + \alpha \cdot \max(0, t-k)) \in (0, 1]$ since $\alpha > 0$ and $\max(0, t-k) \geq 0$. Multiplying $c \in [0,1]$ by a value in $(0, 1]$ yields a value in $[0, 1]$. ∎

**Property 2 (Identity at minimum execution).** When $t = k$ (each slot uses exactly one tool call), $f(c, k, k) = c$.

*Proof.* $\max(0, k - k) = 0$, so the penalty term is $1/(1 + 0) = 1$. Therefore $f = c \cdot 1 = c$. ∎

**Property 3 (No structural ceiling).** For any $k \geq 1$, $\sup_{c, t} f(c, t, k) = 1$, achieved at $c = 1, t = k$.

This is the property that the prior formula $f_{\text{old}}(c, t, k) = c/t$ failed: $f_{\text{old}}(1, k, k) = 1/k$, structurally capping k-slot compositions. Packet 26 proved this rigorously. The new formula corrects it.

**Property 4 (Monotonic decreasing in excess).** $\partial f / \partial t \leq 0$ wherever the derivative is defined.

*Proof.* For $t < k$: $\max(0, t-k) = 0$, $f = c$, $\partial f / \partial t = 0$.
For $t > k$: $\max(0, t-k) = t - k$, so $f(c, t, k) = c / (1 + \alpha(t - k))$.

$$
\frac{\partial f}{\partial t} = c \cdot \frac{-\alpha}{(1 + \alpha(t-k))^2} \leq 0
$$

since $c \geq 0, \alpha > 0$. ∎

At $t = k$, the function has a kink (continuous but not differentiable). This is intentional: there is no penalty for the minimum-required tool calls and a continuous penalty for each excess call.

**Property 5 (Continuity).** $f$ is continuous in $t$.

*Proof.* The left limit as $t \to k^-$ gives $f \to c$. The right limit as $t \to k^+$ gives $f \to c / (1 + 0) = c$. ∎

**Property 6 (Local elasticity).** For $t > k$, the elasticity of fitness with respect to tool_calls is:

$$
\eta_t = \frac{\partial f / f}{\partial t / t} = \frac{-\alpha \cdot t}{1 + \alpha \cdot (t-k)}
$$

For $\alpha = 0.1$, $k = 2$, $t = 3$ (one excess call): $\eta_t = -0.3/1.1 \approx -0.273$. A 1% increase in tool_calls reduces fitness by 0.273%. This is a gentle slope, which is what Packet 27's Bayesian optimization converged toward.

### 1.3 Why $\alpha = 0.1$ Specifically

Packet 27's Bayesian optimization over $\alpha \in [0.1, 5.0]$ converged to the lower bound. This is itself a mathematical finding worth articulating formally.

Consider the fitness landscape's *gradient quality* as a function of $\alpha$. Define:

$$
Q(\alpha) = \mathbb{E}_{g \sim P_g}\left[\left|\nabla_g f(c(g), t(g), k)\right|\right] - \lambda \cdot \mathbb{V}_{g \sim P_g}\left[f(c(g), t(g), k)\right]
$$

where $P_g$ is the distribution of genomes under the mutation operator and $\lambda > 0$ is a regularization constant penalizing high variance.

The first term rewards landscapes where small genome changes produce measurable fitness changes (gradient exists for selection). The second term penalizes landscapes where small changes produce wild fitness swings (selection becomes noisy).

For $f(c, t, k) = c / (1 + \alpha(t-k))$ with $t > k$:

$$
\frac{\partial f}{\partial t} = \frac{-\alpha c}{(1 + \alpha(t-k))^2}
$$

The numerator scales linearly with $\alpha$; the denominator scales quadratically. Net behavior: large $\alpha$ produces large local gradients but only near $t = k$, with gradient vanishing rapidly for $t \gg k$. Small $\alpha$ produces small but consistent gradients across all $t$.

For evolutionary selection in a finite population, *consistent* gradient is more valuable than *steep* gradient. Selection acts on relative fitness differences across the population; if those differences are localized to a narrow band of $t$ values, most of the population sees no gradient at all.

This explains why Bayesian optimization converged to $\alpha = 0.1$: the gentlest available penalty produces the most consistent gradient across the genome space the population actually explores.

### 1.4 Connection to RL Reward Shaping

The current formula is structurally similar to reward shaping techniques in reinforcement learning. Specifically, the formulation:

$$
f = \underbrace{c}_{\text{primary reward}} \cdot \underbrace{\frac{1}{1 + \alpha \cdot \text{excess}}}_{\text{cost-shaping factor}}
$$

is the *multiplicative* form of reward shaping. The additive form would be $f = c - \beta \cdot \text{excess}$ (Option D in Packet 27). Both forms are valid; the multiplicative form was chosen because it preserves the $[0,1]$ scale and the "fitness $\leq$ correctness" intuition.

RL reward shaping literature (Ng, Harada, Russell 1999) establishes that reward shaping preserves optimal policies if the shaping function is a potential function: $\Phi(s')-\Phi(s)$ for some $\Phi$. The current formula is not a strict potential-based shaping (it's a state-dependent multiplier on the primary reward), but the analogous principle holds: the shaping factor's gradient should point toward better policies (here, toward fewer wasteful tool calls), and it does monotonically.

## Part 2: Selection Dynamics

### 2.1 Selection Coefficient

The selection coefficient measures the relative fitness advantage of a mutant compared to the population mean:

$$
s = \frac{f_{\text{mutant}} - \bar{f}}{\bar{f}}
$$

In Packet 26, observed selection coefficients in the failure-to-success transition were $s \in [0.4, 6.6]$ — very strong selection. At the 0.500 ceiling (under the old formula), $s = 0$ — no selection signal.

Under the new formula, the transition from failure to perfect execution produces $s$ comparable to before (the failure-to-success cliff hasn't changed; what's changed is what happens *after* success). Above the success threshold, the new formula creates a continuous gradient $s_{\text{excess}} = -\eta_t$ for excess tool calls — small but consistent.

### 2.2 Fixation Probability

Kimura's diffusion approximation gives the probability that an advantageous mutation fixes in a population of size $N$:

$$
P_{\text{fix}}(s, N) = \frac{1 - e^{-2s}}{1 - e^{-2Ns}}
$$

Special cases:

- **Neutral mutation ($s \to 0$):** Apply L'Hôpital: $P_{\text{fix}} = 1/N$. A neutral mutation fixes with probability $1/N$, the rate of pure genetic drift.

- **Weak selection ($s > 0$ small, $N$ moderate):** $P_{\text{fix}} \approx 2s$. A 1% fitness advantage gives a ~2% chance of fixation per mutation event.

- **Strong selection ($Ns \gg 1$):** $P_{\text{fix}} \approx 1 - e^{-2s}$. For $s = 0.5$, this gives $P_{\text{fix}} \approx 0.63$.

For the Martian regime ($N = 100$, $s$ from observed evolution data):

| $s$ | $P_{\text{fix}}$ (drift threshold: $1/(2N) = 0.005$) | Regime |
|-----|-----------------------|--------|
| 0.001 | 0.010 | Drift-dominated |
| 0.01 | 0.020 | Weakly selected |
| 0.1 | 0.181 | Strongly selected |
| 0.5 | 0.632 | Near-deterministic fixation |
| 1.0 | 0.864 | Strong fixation |

The critical threshold $s > 1/(2N) = 0.005$ separates regimes where selection acts on the trait from regimes where drift dominates.

### 2.3 Expected Time to Fixation

The expected number of generations until an advantageous mutation fixes (Kimura & Ohta 1969):

$$
T_{\text{fix}}(s, N) \approx \frac{4N}{s} \cdot \frac{1 - e^{-2s}}{1 - e^{-2Ns}} \cdot \log\left(\frac{2Ns}{1 - e^{-2Ns}}\right)
$$

For small $s$ (weak selection): $T_{\text{fix}} \approx \frac{2}{s} \log(2Ns)$.

For Martian-scale $N = 100$:

| $s$ | $T_{\text{fix}}$ generations | Practical implication |
|-----|------------------------------|----------------------|
| 0.005 | ~2000 | At drift threshold; slow |
| 0.01 | ~1060 | Selectively meaningful but slow |
| 0.05 | ~240 | Reasonable evolution timescale |
| 0.1 | ~130 | Fast evolution |
| 0.5 | ~30 | Very fast |
| 1.0 | ~15 | Near-immediate |

Packet 25 observed convergence in 4-5 generations for single-tool Martians; this is consistent with $s \approx 1.0$ during the early failure-to-success transition.

### 2.4 Scaling Selection to Subagent Populations

If Subagents have $L_S = 512$ char genomes and population size $N_S$, the relevant fixation properties shift:

- For the *same* selection coefficient $s$, fixation time $T_{\text{fix}}$ scales linearly with $N$. Going from $N = 100$ to $N_S = 1000$ multiplies fixation time by 10. This is the standard population-genetics scaling.

- The selection threshold $1/(2N_S) = 0.0005$ is more permissive: weaker mutations can still escape drift. This is one of the advantages of larger populations.

- *But* the search space scales superexponentially with genome length. The effective dimensionality of $L_M = 256$ Martian genomes is bounded by the number of distinct Xcodes (256/2 = 128); for $L_S = 512$, it's 256. Larger genomes need larger populations to maintain diversity, not just to permit weaker selection.

The relationship between minimum population size and effective dimensionality is roughly $N \gtrsim D \cdot \log D$ from coupon-collector-style arguments. For $D = 256$ Subagent Xcodes, $N_S \gtrsim 256 \cdot \log 256 \approx 1400$.

**Implication for Subagent design.** When the Subagent layer is built, population sizes need to be $\geq$ 1000-1500 to maintain meaningful selection across the genome's full effective dimensionality. This is 10-15× the current Martian population size and is the primary reason Packet 25's storage bottleneck must be addressed before Subagent evolution can scale.

### 2.5 Effective Population Size Considerations

The "effective population size" $N_e$ used in fixation calculations differs from the census size in several ways:

- **Selection sweeps reduce $N_e$.** During fast convergence, the population briefly bottlenecks at the lineage of the winning mutation.
- **Diversity preservation increases $N_e$.** If the mutation operator maintains diversity (Packet 25 showed Martian populations never reach monoculture in 500 generations at $N = 100$), $N_e$ approaches the census size.
- **Selection mode matters.** Tournament selection (current) is typically harsher than rank-proportional or fitness-proportional selection; $N_e \approx N / 2$ is a reasonable rule of thumb for tournament selection.

For AlienClaw's tournament selection at $N = 100$: $N_e \approx 50$, and the drift threshold is $1/(2 N_e) = 0.01$. This is consistent with Packet 26's observation that selection coefficients below ~0.01 produced flat fitness curves.

For future Subagent populations at $N_S = 1500$: $N_e \approx 750$, drift threshold $1/1500 \approx 0.0007$. Subagent evolution can act on much weaker fitness gradients than Martian evolution can — useful because the Subagent fitness landscape (multi-Martian campaigns aggregating to a single objective) is likely smoother and more gradient-rich than Martian fitness.

## Part 3: Information Theory of Genome → Fitness

### 3.1 Information Content of a Genome

A Base62 character carries $\log_2(62) \approx 5.954$ bits of information. A Martian genome of $L_M = 256$ chars carries $\approx 1524$ bits maximum. A Subagent genome of $L_S = 512$ carries $\approx 3049$ bits; $L_S = 1024$ carries $\approx 6098$ bits.

This is the upper bound on the information *available* to selection. The information *exploitable* by selection is bounded by the fitness signal's entropy, not the genome's.

### 3.2 Information Content of the Fitness Signal

For a binary success/failure regime (correctness $\in \{0, 1\}$, success rate $p$), the fitness signal carries:

$$
H(F) = -p \log_2 p - (1-p) \log_2(1-p)
$$

At maximum entropy ($p = 0.5$), $H(F) = 1$ bit. The binary fitness landscape AlienClaw's Martians operate against contains at most 1 bit of differentiable information.

This is the source of the "1525 genome bits, 1 fitness bit" mismatch I flagged in conversation. Selection acting on 1 bit of signal cannot meaningfully exploit 1525 bits of genome — most of the genome is in the *neutral* regime where mutations don't affect fitness in distinguishable ways.

Under the new fitness formula, this changes: post-success, additional fitness signal exists in the form of tool_calls efficiency. The fitness $f$ is now continuous in $[0, 1]$, not binary. The information content of $f$ is bounded by $\log_2(M)$ where $M$ is the number of distinguishable fitness levels achievable in the population.

For practical purposes (with finite population $N = 100$ and finite precision), $M \approx 10$ to $20$ distinguishable levels, giving $H(F) \approx \log_2 M \approx 3$ to $4$ bits.

The fitness signal has gone from 1 bit to 3-4 bits under the new formula. This is a ~3-4× improvement in exploitable information without changing the genome.

### 3.3 Mutual Information Between Genome and Fitness

The mutual information $I(G; F)$ quantifies how much fitness reveals about the genome:

$$
I(G; F) = H(F) - H(F|G) = H(G) - H(G|F)
$$

This is bounded:
- $I(G; F) \leq H(F)$: cannot extract more information from $G$ than $F$ has
- $I(G; F) \leq H(G)$: cannot have more information than the genome contains

Under the *old* formula, $I(G; F) \leq H(F) \leq 1$ bit. Under the *new* formula, $I(G; F) \leq H(F) \leq 3$-$4$ bits.

Selection efficiency scales with $I(G; F)$: more information means more bits of the genome can be selected upon per generation.

### 3.4 Implications for Subagent-Scale Selection

For a $L_S = 512$ Subagent genome with $\approx 3049$ bits, achieving $I(G; F) / H(G) \approx 0.1\%$ (the Martian ratio under the new formula: ~3 bits / 1525 bits) would yield ~3 bits of mutual information per evaluation. Across $T$ generations, the cumulative information selection can act on scales as $O(T \cdot I(G;F))$ in the small-mutation limit.

For the Subagent regime, this suggests:

- **Need richer fitness signals.** A binary "campaign succeeded" reward is insufficient; multi-dimensional fitness (correctness, efficiency, latency, error diversity) is necessary to provide selection with enough information to navigate $\approx 3049$ bits of genome.

- **Curriculum-based difficulty scaling.** As the population improves, task difficulty should scale so fitness remains in the high-entropy regime (around $p = 0.5$ for binary success rates).

- **Auxiliary objectives.** Intermediate-process rewards (e.g., "slot 0 produced parseable output") add information per evaluation, supplementing the terminal reward.

These are not implementation decisions for now; they're requirements the Subagent fitness design must satisfy when that work begins.

## Part 4: The Mutation Operator

### 4.1 Current Specification

Per Packet 15, mutation is step-based directional at the Xcode level:

- Per-Xcode mutation rate: $\mu \approx 0.0078$
- Step size distribution: $\pm 1$ at 60%, $\pm 2$ at 25%, $\pm 3$ at 10%, $\pm 4$ at 5%
- Direction bias: 70/30 driven by the `.msb` `direction` field

### 4.2 Mutation Operator as Random Walk

For a single Xcode, the per-generation change in value is a discrete random variable:

$$
\Delta X = D \cdot \text{Step}
$$

where $D \in \{+1, -1\}$ with biased probabilities $(0.7, 0.3)$ depending on direction, and Step has the distribution above.

The expected step is:
$$
\mathbb{E}[\Delta X] = (0.7 - 0.3) \cdot \mathbb{E}[\text{Step}] = 0.4 \cdot (1 \cdot 0.6 + 2 \cdot 0.25 + 3 \cdot 0.1 + 4 \cdot 0.05) = 0.4 \cdot 1.6 = 0.64
$$

The variance of the step:
$$
\mathbb{V}[\text{Step}] = \mathbb{E}[\text{Step}^2] - (\mathbb{E}[\text{Step}])^2
$$

$\mathbb{E}[\text{Step}^2] = 1^2 \cdot 0.6 + 2^2 \cdot 0.25 + 3^2 \cdot 0.1 + 4^2 \cdot 0.05 = 0.6 + 1.0 + 0.9 + 0.8 = 3.3$

$\mathbb{V}[\text{Step}] = 3.3 - 1.6^2 = 3.3 - 2.56 = 0.74$

So $\sigma_{\text{Step}} \approx 0.86$.

The directional drift $\mathbb{E}[\Delta X] = 0.64$ per mutation event is the signal; the random component $\sigma_{\text{Step}} \approx 0.86$ is the noise. Signal-to-noise: ~0.74.

### 4.3 Time to Traverse Parameter Range

For a parameter ranging over $R$ Xcode values (e.g., `result_format` $\in \{1, 2, 3\}$ has $R = 3$; `max_results` $\in [1, 100]$ has $R = 100$):

The number of mutations needed to traverse the range (random walk first-passage time) scales as $T \sim R^2 / \mathbb{V}[\Delta X]$ in the unbiased case, or $T \sim R / |\mathbb{E}[\Delta X|]$ in the strongly biased case.

For AlienClaw's mutation operator at $R = 100$:
- Unbiased: $T \sim 100^2 / 0.74 \approx 13500$ mutation events
- Biased: $T \sim 100 / 0.64 \approx 156$ mutation events

Per genome per generation, $\mu \cdot L \approx 0.0078 \cdot 256 \approx 2$ mutations occur on the whole genome. Per specific Xcode per generation, the mutation rate is $\mu \approx 0.0078$, meaning the expected wait between mutations is $1/\mu \approx 128$ generations.

To traverse a 100-value parameter range in the biased case takes 156 mutation events × 128 generations per event = ~20,000 generations *per genome*. In a population of 100, the population-level rate is 100× faster: ~200 generations to traverse a 100-value range when direction is informative.

This is consistent with Packet 25's observation that single-tool Martians converged in 2-5 generations: their fitness gradient was so strong that convergence happened before significant parameter-range traversal was needed.

### 4.4 Scaling to Subagent Genomes

For $L_S = 512$ Subagent genomes:
- Total mutations per genome per generation: $\mu \cdot L_S \approx 4$
- Per-Xcode rate unchanged: $\mu \approx 0.0078$
- Effective dimensionality doubles: 256 Xcodes vs 128 Xcodes

The mutation operator scales naturally: each Xcode still mutates at the same rate, but more Xcodes exist per genome. The directional bias remains per-Xcode, controlled by the `.msb` `direction` field.

For Subagent-scale evolution, the time to traverse parameter ranges remains comparable to Martian-scale. The bottleneck shifts to *generation count needed to evolve the full genome*, not single-parameter traversal time.

If we assume Subagents need to optimize ~50% of their Xcodes (256 × 0.5 = 128 active Xcodes) at parameter ranges similar to Martians ($R \approx 10$ average), the expected generation count is:

$T_{\text{Subagent evo}} \sim 128 \cdot R^2 / (\mu \cdot N_S \cdot \mathbb{V}[\Delta X])$

For $N_S = 1500, R = 10, \mu = 0.0078, \mathbb{V}[\Delta X] = 0.74$:

$T \sim 128 \cdot 100 / (0.0078 \cdot 1500 \cdot 0.74) \approx 12800 / 8.66 \approx 1480$ generations

This is the rough order-of-magnitude expected time for Subagent population convergence. Compare to Martians at 50-500 generations: Subagents will take 3-30× longer to converge.

### 4.5 Mutation Rate as Architectural Parameter

The per-Xcode mutation rate $\mu \approx 0.0078$ was chosen empirically in earlier packets. The theoretical optimum (Eigen's quasispecies model) suggests:

$$
\mu_{\text{opt}} \approx \frac{1}{L_{\text{effective}}}
$$

where $L_{\text{effective}}$ is the number of fitness-relevant loci. For Martians with $L_{\text{effective}} \approx 128$: $\mu_{\text{opt}} \approx 1/128 \approx 0.0078$. The empirical value is at the theoretical optimum.

For Subagents with $L_{\text{effective}} \approx 256$: $\mu_{\text{opt}} \approx 1/256 \approx 0.0039$. The Subagent mutation rate should be halved when that layer is built. This is a specific quantitative prediction for the Subagent design.

## Part 5: Composition Architecture

### 5.1 Slot Walking and Input Wiring

Per Packet 16, Martian execution walks slots sequentially:

1. Slot 0 receives campaign inputs, executes tool, produces output
2. Slot 1 receives slot 0's output (via `inputs_from` declarations) + campaign inputs, executes tool, produces output
3. ...up to slot $k-1$

Mathematically, this defines a directed acyclic graph (DAG) of data flow. The genome encodes parameters for each slot's tool; the `.martian` file encodes the DAG structure.

For a k-slot Martian:

$$
\text{output}_k = \tau_{k-1}\left(\text{decode}_{k-1}(G), \, \text{inputs}_{\text{campaign}}, \, \text{output}_{k-1}, \, \ldots\right)
$$

where $\tau_i$ is the i-th tool's behavior and $\text{decode}_i$ extracts slot i's parameters from the genome.

### 5.2 Information Flow Bottleneck

Each slot's output is constrained by its tool's output shape (declared in `.msb` `OUTPUTS`). The bridge passes only the declared output to the next slot. This is information-theoretic bottlenecking — useful for safety, problematic for evolvability.

Specifically: if slot 0's output has limited variance (e.g., file_read returns either valid content or an error indicator), slot 1 sees a low-entropy input regardless of slot 0's parameters. This was the root cause of read_then_extract's WEAK signal in Packet 21.

The bottleneck capacity is:

$$
C_{i \to i+1} = \log_2\left|\{\text{output}_i\}\right|
$$

where $\{\text{output}_i\}$ is the set of distinct outputs slot $i$ produces over the genome distribution.

For read_then_extract: file_read's output set is small (truncation cliff produces mostly empty content), so $C_{0 \to 1}$ is low. extract_json sees a low-entropy input, so its own output entropy is also low, and the composition's overall fitness signal is degraded.

**Architectural implication.** When designing compositions (or letting Subagents construct compositions dynamically), the inter-slot information bandwidth matters. Compositions where slot $i$ produces low-entropy output that slot $i+1$ depends heavily on will show poor evolvability regardless of the fitness formula.

### 5.3 Composition vs Single-Tool Trade-off

Under the new fitness formula, a k-slot composition achieving perfect execution scores 1.0, equal to a single-tool Martian. But this requires:

- All $k$ slots succeed ($c_i = 1$ for all $i$)
- Total tool_calls equals slot_count ($t = k$, one per slot)

For statistically independent slot failures with per-slot failure probability $p_{\text{fail}}$, the probability of full composition success is:

$$
P_{\text{success}}(k) = (1 - p_{\text{fail}})^k
$$

For $p_{\text{fail}} = 0.1$ (10% per-slot failure rate):

| $k$ | $P_{\text{success}}$ |
|-----|---------------------|
| 1 | 0.900 |
| 2 | 0.810 |
| 4 | 0.656 |
| 8 | 0.430 |
| 16 | 0.185 |

Even with the ceiling removed, longer compositions are less likely to *fully succeed* under realistic per-slot failure rates. The expected fitness of a k-slot composition under the new formula is:

$$
\mathbb{E}[f(k)] = P_{\text{success}}(k) \cdot 1 + P_{\text{partial}}(k) \cdot f_{\text{partial}}
$$

Since $c$ aggregates via min, partial successes have $c = 0$ when any slot fails. So $\mathbb{E}[f(k)] \approx P_{\text{success}}(k) \cdot 1$.

For the Subagent regime ($k = 8$ or $16$), $P_{\text{success}}$ requires per-slot reliability $\geq 0.9$. This is an architectural constraint on Subagent-evolved compositions: the tools they orchestrate must individually be highly reliable, or the composition can't reach high fitness.

### 5.4 Alternative Aggregation Rules

The current min-aggregation for correctness is harsh. Alternative aggregation rules with different properties:

- **Mean**: $c = (\sum c_i) / k$. Partial credit for partial success. Smoother gradient but loses the "all must work" semantics.
- **Geometric mean**: $c = (\prod c_i)^{1/k}$. Multiplicative aggregation; one slot failing partially still produces non-zero fitness if others compensate.
- **Min** (current): $c = \min c_i$. Strict; one slot failure → composition failure.
- **Soft-min**: $c = -\frac{1}{\beta} \log \sum e^{-\beta c_i}$. Differentiable approximation of min; controlled by $\beta$.

The choice of aggregation affects what compositions look like in fitness landscape:

- Min: cliffs at slot failure boundaries
- Mean: smooth gradient through partial-success regions
- Geometric: rewards balanced slot performance over uneven performance

For the Subagent regime, smoother aggregation (mean or soft-min) likely produces better evolvability. But min preserves the "composition must succeed end-to-end" semantics which is what users expect. This is an open architectural question for the Subagent layer.

## Part 6: Subagent-Scale Predictions

### 6.1 Population Size

Per Section 2.4: $N_S \geq 1500$ for effective dimensionality of $\approx 256$ Xcodes. Probably round to $N_S = 2048$ for clean powers of 2.

### 6.2 Mutation Rate

Per Section 4.5: $\mu_S = 1/256 \approx 0.0039$. Halve the current Martian rate when Subagents are built.

### 6.3 Generations to Convergence

Per Section 4.4: $T_{\text{converge}} \sim 1500$ generations for full Subagent genome convergence under realistic conditions. Compare to Martian: 50-500 generations. Subagent evolution is roughly 3-30× slower per population.

### 6.4 Storage Requirements

Per Packet 25's findings, naive population storage at $N = 100$, $T = 500$ produced ~100K files per seed. Scaling:
- $N_S = 2048$, $T_S = 1500$: ~3M files per seed under current storage
- File I/O bottleneck (88% of wall-clock per Packet 25) becomes catastrophic at this scale

The storage layer redesign is *prerequisite* for Subagent evolution. Specifically:
- Streaming JSONL per generation (one file per generation, not per genome): 1500 files per seed
- Or compact binary format: single file per seed with structured access
- Or database backend: SQLite or similar with proper indexing

### 6.5 Fitness Signal Requirements

Per Section 3.4, Subagent fitness must provide $H(F) \geq 5$-$10$ bits of signal per evaluation. The current binary success/failure can't scale. Required additions:

- Multi-dimensional fitness (correctness, efficiency, latency, error_diversity)
- Curriculum-driven task difficulty
- Auxiliary objectives (intermediate-process rewards)

This is the most important architectural finding for Subagent design.

### 6.6 Selection Threshold

At $N_S = 2048$: $1/(2 N_e) \approx 0.00025$. Subagent evolution can act on selection coefficients as weak as ~0.0003. Compare to Martians at $1/(2 \cdot 50) = 0.01$. Subagents can navigate much subtler fitness landscapes.

## Part 7: Open Mathematical Questions

These remain unresolved and merit investigation when the Subagent layer is built:

### 7.1 Pareto Frontier for Multi-Objective Subagent Fitness

If Subagent fitness becomes multi-objective (e.g., (correctness, efficiency, latency)), selection must operate on Pareto-dominated relationships rather than scalar fitness. The NSGA-II algorithm's complexity is $O(M N^2)$ for $M$ objectives and $N$ population. For $M = 4, N_S = 2048$: $\approx 16$ million comparisons per generation. Computationally feasible but non-trivial.

Pareto frontier characterization for AlienClaw-specific Subagent objectives is an open empirical question. The frontier's shape (convex, concave, mixed) affects which scalarization functions can capture which trade-offs.

### 7.2 Coevolution Dynamics

If Subagent goal distributions evolve alongside Subagent genomes (Subagents face progressively harder tasks as they improve), this is a coevolutionary system. The dynamics:

$$
\frac{dG}{dt} = f_G(G, T) \quad \text{and} \quad \frac{dT}{dt} = f_T(G, T)
$$

where $G$ is the Subagent genome distribution and $T$ is the task distribution. Coevolution can produce:
- Sustained progress (predator-prey arms race dynamics)
- Local equilibria (mediocre stable state)
- Cycling (Red Queen dynamics)

Which regime AlienClaw's Subagents fall into is an open empirical question.

### 7.3 Information-Theoretic Capacity of the Composition Architecture

The bridge's slot-walking architecture imposes information bottlenecks. The aggregate channel capacity from campaign input to final output is:

$$
C_{\text{total}} = \min_i C_{i \to i+1}
$$

This bounds the complexity of tasks the architecture can solve. For Subagents with $k$ slots:

$$
C_{\text{total}}(k) = \min_{i=0}^{k-1} \log_2 \left|\{\text{output}_i\}\right|
$$

The bottleneck is determined by the weakest slot's output entropy. Designing tools and slot connections to maximize $C_{\text{total}}$ is an open architectural question.

### 7.4 Mutation Operator's Stationary Distribution

The current step-based directional mutation operator has a stationary distribution over Xcode values. For an Xcode with valid range $[a, b]$:

If the direction is unbiased (random direction equally likely), the stationary distribution is uniform on $[a, b]$.

If the direction is biased (70/30) toward higher values, the stationary distribution is skewed toward the upper bound. Specifically:

$$
\pi(x) \propto \left(\frac{0.7}{0.3}\right)^{x - a} = (7/3)^{x-a}
$$

This is geometric in shape. For $b - a = 10$: the upper bound is $(7/3)^{10} \approx 18000$ times more likely than the lower bound.

**Implication.** Direction-biased Xcodes spend most of their time near the upper end of the parameter range under neutral evolution. The selection-corrected stationary distribution depends on the fitness function but inherits this bias.

This explains why some parameters in Packet 25's diversity analysis showed strong directional drift: their direction bias was pushing them toward range boundaries even without strong selection.

For Subagent design: the direction bias is per-parameter, encoded in `.msb` files. Subagent-relevant parameters may need different bias settings depending on whether high or low values are "better" by default.

## Part 8: Architectural Invariants

These are properties that should hold across any future architectural extension:

### 8.1 Fitness Boundedness

$f \in [0, 1]$ at all levels of the architecture (per-tool, per-Martian, per-Subagent, per-Campaign). Bounded fitness simplifies selection, makes cross-level comparisons meaningful, and prevents numerical instability.

### 8.2 Composability

If $M_1, M_2, \ldots, M_k$ are k well-defined Martians (each with their own genome, fitness, evolution), a composition of them should be a well-defined Martian with appropriately aggregated genome, fitness, evolution. This is currently satisfied at the Martian level via slots and the new fitness formula.

For Subagents: orchestrating $k$ Martians via a multi-Martian campaign should produce a well-defined Subagent with appropriately aggregated properties. The Packet 18 fitness aggregation rule satisfies this:

$$
f_{\text{Subagent}} = f_{\text{final martian}} + 0.2 \cdot \mathbb{1}_{\text{terminated normally}}
$$

with clipping to $[0, 1]$.

### 8.3 Deterministic Evolution

Given seed $s$, mutation rate $\mu$, population $P_0$, and fitness function $f$, the population trajectory $P_0, P_1, \ldots, P_T$ is deterministic. This is essential for reproducibility, debugging, and scientific claims about evolution.

### 8.4 Genome Format Stability

The Base62 encoding, 64-char slot structure, and Xcode definitions are stable across architectural levels. A Martian genome's bytes 64-127 (slot 1) have the same semantics as a Subagent genome's bytes 64-127 if the Subagent declares slot 1 to use the same tool. This composability allows tools and brains to be reused across architectural levels.

### 8.5 Slot Independence at the Mutation Level

Mutation operators act on Xcodes within slots; cross-slot dependencies (information flow) are managed by the bridge at execution time, not by the mutation operator. This separation of concerns means scaling from Martian to Subagent doesn't require changes to the mutation operator beyond adjusting the mutation rate.

## Part 9: Recommended Research Sequence Pre-Subagent

Before the Subagent layer is built, three research sequences should run on the Martian layer:

### 9.1 Storage Layer Redesign

Required for Subagent-scale populations. Replace per-genome files with streaming JSONL per generation or binary blob per seed. Estimated complexity: medium; estimated impact: enables $N \geq 1000$ populations.

### 9.2 Multi-Objective Fitness Pilot

Implement a vector-fitness version of the current architecture on a few Martians. Compare scalar vs vector selection (NSGA-II vs tournament) at $N = 100$. Validates Pareto-frontier methodology before committing it to Subagent design.

### 9.3 Information-Theoretic Bandwidth Audit

For every composition in the canonical registry: measure $C_{i \to i+1}$ for each slot pair under realistic genome distributions. Identify which compositions are bandwidth-bottlenecked vs well-balanced. Inform Subagent composition design.

## Conclusion

The Martian layer's mathematical foundation is solid after the post-correction arc. The fitness formula is bounded, monotonic, scales to arbitrary slot counts, and produces evolutionarily meaningful gradients. The mutation operator is at its theoretical optimum per-Xcode rate. Selection dynamics in the current $N = 100$ population are well-characterized via Kimura's framework.

The Subagent layer can be built on this foundation, with the following quantitative predictions:
- Population size $N_S \approx 2048$
- Mutation rate $\mu_S \approx 0.0039$ (half of Martian rate)
- Convergence time $T_{\text{converge}} \approx 1500$ generations
- Required fitness signal entropy $H(F) \geq 5$-$10$ bits per evaluation
- Selection threshold $\geq 0.0003$
- Storage requirements: streaming format mandatory; current per-file model infeasible

These predictions are testable. When Subagent evolution experiments run, deviations from these predictions are themselves findings — they indicate either flaws in the theoretical analysis or unexpected emergent properties of the system.

The post-correction arc concluded with these foundations in place. Future work has the math it needs.

---

*This document last updated: post-Packet-28. Maintained as the canonical mathematical reference for AlienClaw architecture. Updates should be made via packets that include explicit "MATHEMATICAL_FOUNDATIONS.md amendment" in their scope.*
