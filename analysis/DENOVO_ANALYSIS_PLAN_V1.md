# De Novo Bimanual Learning — Analysis Plan v1

Status: pre-data-collection analysis plan for the v19-10 two-direction task.
Scope: acquisition, discovery vs implementation, movement-policy structure, hand coordination, and early post-baseline carryover. Novel-target transfer is intentionally deferred until acquisition is demonstrated in naive pilots.

## 1. Core scientific questions

1. Can naive participants acquire a stable, successful control policy within 100 de novo trials?
2. Can discovery of the correct cursor direction be separated from implementation speed?
3. What hand policy is used to solve the task: relatively independent control of the two task-relevant dimensions, a coupled/yoked strategy, or another stable policy?
4. Does policy search look continuous or does behavior occupy discrete candidate-policy states? This is exploratory in v1.
5. What happens immediately after the mapping is restored to baseline?

## 2. Why hand policy must be analyzed directly

The bimanual mapping is redundant:
- Left-hand vertical movement controls cursor horizontal movement.
- Right-hand horizontal movement controls cursor vertical movement.
- Left-hand horizontal and right-hand vertical movements are null dimensions.

Therefore, a participant can reach the same cursor target using multiple hand trajectories. A diagonal or parallel two-hand movement can be a valid motor policy even when it contains large null-dimension components. It must not automatically be coded as an error.

Haith et al. (2022) and Kita et al. (2025) both treat this redundancy as part of the behavior to characterize. Kita et al. additionally infer policy from the joint distribution of initial left- and right-hand movement directions. The present analysis follows that logic but keeps strategy measures continuous rather than imposing a discrete strategy label in the primary analysis.

## 3. Unit of analysis

Primary unit: one de novo attempt.

Each row in `denovo_trials.csv` contains:
- target and trial number,
- target onset and movement timing,
- left-hand initial movement direction,
- right-hand initial movement direction,
- cursor initial movement direction and target-relative error,
- target-normalized policy coordinates,
- hand-direction separation,
- controller-relevant and null-dimension movement,
- peak cursor radius/direction,
- endpoint direction/error,
- runtime outcome when the detailed `reaches` record is available.

All attempts are retained, including timeouts and misses.

## 4. Fixed offline definitions

### 4.1 Initial movement window

Initial movement direction is estimated over a fixed 100-ms displacement window.

Left hand:
`left position at left-hand onset + 100 ms - left position at left-hand onset`

Right hand:
`right position at right-hand onset + 100 ms - right position at right-hand onset`

Cursor:
`cursor position at confirmed de novo launch + 100 ms - cursor position at confirmed launch`

Angles use the task convention in which positive Y on screen is converted to conventional Cartesian angle by negating Y.

The 100-ms window is chosen before formal data analysis and mirrors the emphasis on early movement direction in Kita et al. while being robust to the approximately 30-Hz online webcam sampling.

### 4.2 Cursor discovery measures

Primary continuous discovery measure:
`absolute initial cursor directional error at 100 ms`

Secondary binary measure:
`initial direction correct = |initial cursor directional error| <= 8.192°`

The 8.192° threshold is the same angular tolerance implied by the task geometry:
target radius = 0.70, target hit radius = 0.10.

Task hit is kept as a separate composite outcome because it reflects both policy direction and execution.

### 4.3 Implementation measures

Primary implementation measures:
- planning time,
- movement-window time,
- 600-ms completion status.

A trial that has the correct direction but exceeds the movement window is classified as discovery-correct / implementation-failed, rather than discovery-failed.

### 4.4 Target-normalized hand-policy coordinates

Canonical task-relevant hand directions:

| Target | Left hand | Right hand |
| --- | ---: | ---: |
| UP-LEFT | DOWN (-90°) | LEFT (180°) |
| DOWN-RIGHT | UP (+90°) | RIGHT (0°) |

For each hand:
`policy error = observed initial hand direction - target-specific canonical direction`, wrapped to [-180°, 180°].

This removes target identity so that the same underlying motor strategy should occupy a similar location in policy space across the two trained targets.

### 4.5 Coupling / coordination

Primary continuous coordination measure:
`hand-direction separation = circular distance(left initial direction, right initial direction)`

Small values indicate approximately parallel/yoked initial movements. Values near 90° are consistent with the canonical orthogonal hand solution.

No hard threshold for “coupled” vs “independent” will be imposed in v1.

### 4.6 Null-dimension use

Task-relevant initial displacement:
`sqrt(LeftY^2 + RightX^2)`

Null initial displacement:
`sqrt(LeftX^2 + RightY^2)`

Null/relevant ratio:
`null magnitude / relevant magnitude`

A value near zero means movement is concentrated in controller-relevant dimensions. Larger values indicate substantial redundant/null-dimension movement. Large values are not automatically treated as poor performance.

## 5. Acquisition analysis

### Descriptive learning curves

The 100 de novo trials are summarized in five pre-specified 20-trial bins:
1–20, 21–40, 41–60, 61–80, 81–100.

For each bin report:
- mean absolute initial cursor directional error,
- initial-direction-correct rate,
- hit rate,
- timeout rate,
- median planning time,
- median movement-window time,
- median hand-direction separation,
- median null/relevant ratio.

Trial-by-trial values remain the primary data; bins are for visualization and pilot diagnostics.

### Formal group analysis after pilot freeze

Primary acquisition model:
`absolute initial cursor directional error ~ trial + target + (1 + trial | participant)`

Because learning may be nonlinear, the planned robust comparison will also include a pre-specified early-vs-late contrast:
trials 1–20 versus trials 81–100.

Secondary binary model:
`initial direction correct ~ trial + target + (1 + trial | participant)`
with a binomial mixed-effects model.

Task hit is secondary because it combines discovery and implementation.

## 6. Discovery vs implementation

Discovery is indexed primarily by early cursor direction.

Implementation is evaluated conditionally among attempts with a correct early cursor direction:
- planning time,
- movement-window time,
- probability of completing within 600 ms.

This prevents `correct_direction_too_slow` trials from being counted as failures to discover the rule.

## 7. Movement-policy analysis

Primary strategy outputs:
- left target-normalized policy error,
- right target-normalized policy error,
- hand-direction separation,
- null/relevant ratio.

Late-policy stability will initially be summarized over trials 81–100.

The analysis will not assume that the canonical cardinal hand solution is the only successful strategy.

## 8. Candidate policy states / clusters

Exploratory only in v1.

Potential signatures of discrete hypothesis testing:
- repeated occupancy of a compact region of left/right policy space,
- several consecutive trials in that region,
- abrupt transition to another region,
- stay/switch behavior related to preceding success or error.

Clustering alone will not be interpreted as evidence of hypothesis learning. Clusters could also reflect biomechanics, target-specific action policies, or coordination preferences.

If multiple naive participants show clear state-like behavior, a later model-comparison stage can compare:
- continuous state-space / policy-search models,
- discrete latent-state or hidden-Markov policy models,
using held-out predictive performance.

## 9. Aftereffect / mapping-restoration analysis

Post-baseline is treated as a transition/carryover probe, not averaged only across all 20 trials.

Pre-specified summaries:
- trial 1 endpoint error,
- mean absolute endpoint error across trials 1–2,
- trials 1–4,
- all 20 trials,
plus the full trial-by-trial curve.

This is necessary because the pilot shows that large early errors can wash out rapidly and become invisible in a whole-block average.

## 10. Runtime outcome data and raw-data reconstruction

Preferred source for task outcomes:
the detailed `reaches` records downloaded from Firestore.

Raw frames are always used to compute offline hand-policy measures.

If an older pilot file lacks the `reaches` array:
- policy and trajectory measures remain available from raw frames,
- per-attempt task outcomes can be reconstructed approximately,
- reconstructed outcomes are explicitly marked as such and should not replace exact runtime outcome records in the formal dataset.

## 11. Pilot decision before formal recruitment

Before freezing the formal study, collect several genuinely naive pilot participants under the same 100-trial acquisition schedule.

The pilot decision is not based on one participant. We will inspect:
- whether early cursor directional error improves,
- whether a stable late policy emerges,
- whether the last 20 trials are meaningfully better than the first 20,
- whether performance remains dominated by unresolved rule search,
- whether the 600-ms execution requirement is preventing otherwise direction-correct behavior.

Novel-target transfer will only be reconsidered after acquisition is shown to be interpretable within 100 trials.

## 12. Current pilot interpretation

The current repeated-family-member pilot is useful for validating the analysis pipeline and exposing possible strategies, but it is not an estimate of population learning.

It demonstrates why:
- hits alone are insufficient,
- timeouts should be retained,
- left/right hand trajectories must be analyzed,
- coupled diagonal movement can be a valid solution,
- post-baseline must be examined trial by trial,
- exact runtime outcomes and raw movement-policy measures should remain separate columns.

## References used to motivate the analysis

- Haith AM, Yang C, Pakpoor J, Kita K. De novo motor learning of a bimanual control task over multiple days of practice. 2022.
- Kita K, Du Y, Tran T, Haith AM. Switching between Newly Learned Motor Skills. Journal of Neuroscience. 2025.