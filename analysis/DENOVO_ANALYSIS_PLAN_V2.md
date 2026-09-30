# De Novo Analysis Plan V2

Status: pilot-stage planned analysis for the v19-11 two-direction task.

Scope: acquisition, discovery versus implementation, movement-policy structure, hand coordination, explicit rule knowledge, and early post-baseline carryover. Novel-target transfer is intentionally deferred until acquisition is demonstrated in naive participants.

This document is intentionally limited to planned primary, secondary, and descriptive analyses. Exploratory clustering, HMMs, Soft-DTW phenotyping, formal mixture modeling, and formal reinforcement-learning versus hypothesis-testing model comparison are not included at this stage.

## 1. Core scientific questions

1. Can naive participants acquire a stable, successful control policy within 100 de novo trials?
2. Can discovery of the appropriate cursor direction be separated from implementation speed?
3. What hand policy is used to solve the task, given that the bimanual mapping is redundant?
4. Does task-space behavior become more accurate and less variable over practice?
5. Does a participant's explicit knowledge of the component rule correspond to successful motor implementation?
6. What happens immediately after the mapping is restored to baseline?

## 2. Why hand policy must be analyzed directly

The bimanual mapping is redundant:

- Left-hand vertical movement controls cursor horizontal movement.
- Right-hand horizontal movement controls cursor vertical movement.
- Left-hand horizontal and right-hand vertical movements are controller-null dimensions.

Therefore, multiple hand trajectories can produce the same successful cursor movement. A diagonal or approximately parallel two-hand movement can be a valid motor policy even when it contains large null-dimension components. Distance from one canonical cardinal-hand solution is therefore not treated as a learning-error score.

Haith et al. (2022) and Kita et al. (2025) motivate direct analysis of the joint left/right hand policy under a redundant bimanual controller. Ding et al. (2026) further motivates emphasizing individual trial-by-trial trajectories and structured exploration rather than relying only on smooth group-averaged learning curves.

## 3. Unit of analysis

Primary unit: one de novo attempt.

Each row in `denovo_trials.csv` contains or derives:

- participant, block, target, and trial number,
- target onset,
- left-hand offline movement onset,
- right-hand offline movement onset,
- earliest physical motor onset,
- task-relevant onset,
- motor RT,
- task-relevant RT,
- inter-hand onset lag,
- Task MT for completed reaches,
- left-hand initial movement direction,
- right-hand initial movement direction,
- initial task/cursor movement direction and target-relative error,
- target-normalized hand-policy coordinates,
- hand-direction separation,
- controller-relevant and null-dimension movement,
- null fraction,
- peak cursor radius/direction,
- endpoint direction/error,
- exact runtime outcome when the detailed `reaches` record is available.

All attempts are retained, including misses and timeouts.

## 4. Fixed offline definitions

### 4.1 Offline movement-onset algorithm

Scientific movement onset is recomputed from the raw trajectories. Runtime displacement/launch gates are retained only as experiment-control logic and are not treated as the scientific onset definition.

For each signal:

1. regularize samples to the median frame interval;
2. apply a zero-phase second-order Butterworth low-pass filter at 4 Hz;
3. compute two-dimensional tangential speed;
4. estimate the resting-noise floor as the 95th percentile of speed during the 300 ms before target onset;
5. identify the first local outbound speed peak that is at least 30% of the global outbound peak and above the noise floor, with the global peak as fallback;
6. define the onset threshold as `max(10% of selected peak speed, noise floor)`;
7. search backward from the selected peak for the last below-to-above threshold crossing;
8. linearly interpolate the crossing time.

This is the same frozen offline onset logic used in the single-hand N=30 baseline analysis.

Onset is estimated separately for:

- left-hand two-dimensional movement,
- right-hand two-dimensional movement,
- the task-relevant mapped trajectory `[-LeftY, RightX]`.

### 4.2 Initial movement window

Initial movement direction is estimated over the first 100 ms after the corresponding offline onset.

Left hand:

`left position at left onset + 100 ms - left position at left onset`

Right hand:

`right position at right onset + 100 ms - right position at right onset`

Task/cursor:

`task-relevant position at task-relevant onset + 100 ms - task-relevant position at task-relevant onset`

Angles use conventional Cartesian direction after correcting the screen-coordinate Y sign.

### 4.3 Discovery measures

Primary continuous discovery measure:

`absolute initial cursor directional error at 100 ms`

This is treated as the primary index of whether the selected movement initially drives the cursor toward the target.

Secondary binary measure:

`initial direction correct = |initial cursor directional error| <= 8.192°`

The 8.192° threshold matches the angular tolerance implied by the current target geometry. Because this threshold originates from endpoint geometry rather than a theory of initial heading, the continuous directional-error measure remains primary.

Task hit is kept as a separate composite outcome because it combines discovery and implementation.

### 4.4 Runtime outcome decomposition

Each de novo attempt is assigned one of the following outcomes:

- hit,
- endpoint miss,
- timeout: wrong cursor direction,
- timeout: correct direction but too slow,
- timeout: no cursor effect,
- other failure if required.

These categories are retained trial by trial rather than collapsing all failures into a single miss/timeout score.

Large directional errors are not automatically interpreted as execution noise. Their temporal distribution is examined to determine whether they are concentrated early in learning and whether similar errors recur systematically across trials.

### 4.5 Implementation measures

Primary implementation measures:

- Motor RT = earliest offline hand onset - target onset.
- Task-relevant RT = task-relevant onset - target onset.
- Inter-hand onset lag = |left onset - right onset|.
- Task MT = first interpolated r=.70 crossing - task-relevant onset.

Task MT is defined only for completed, non-timeout attempts with a valid task-relevant onset and a target-radius crossing.

The runtime 600-ms completion status is retained as an additional implementation outcome. Runtime movement-window duration is not treated as the scientific MT measure.

### 4.6 Target-normalized hand-policy coordinates

Canonical task-relevant hand directions:

| Target | Left hand | Right hand |
| --- | ---: | ---: |
| UP-LEFT | DOWN (-90°) | LEFT (180°) |
| DOWN-RIGHT | UP (+90°) | RIGHT (0°) |

For each hand:

`policy error = observed initial hand direction - target-specific canonical direction`, wrapped to [-180°, 180°].

These coordinates are used to place movements to both targets in a common policy space. They characterize the policy but are not themselves learning-error scores.

### 4.7 Coupling / coordination

Primary continuous coordination measure:

`hand-direction separation = circular distance(left initial direction, right initial direction)`

Small values indicate approximately parallel/yoked initial movements. Values near 90° are consistent with the canonical orthogonal hand solution.

No hard threshold is imposed to classify a participant as coupled or independent.

### 4.8 Null-dimension use

Task-relevant initial displacement:

`sqrt(LeftY^2 + RightX^2)`

Null initial displacement:

`sqrt(LeftX^2 + RightY^2)`

Descriptive ratio:

`null / relevant`

Preferred bounded measure for group modeling:

`null fraction = null / (null + relevant)`

A value near zero indicates movement concentrated in controller-relevant dimensions. A value near .5 indicates approximately equal null and relevant movement magnitudes. Larger null fractions are not automatically treated as poor performance.

## 5. Acquisition analysis

### 5.1 Trial-by-trial learning curves

Trial-by-trial values are retained as the primary visualization of discovery.

Primary learning curve:

- x-axis: de novo trial 1-100,
- y-axis: absolute initial cursor directional error,
- participant-level trajectories displayed separately when useful.

Group averages are not used as the sole description because smooth averages can obscure heterogeneous individual exploration and abrupt changes in strategy.

### 5.2 Pre-specified 20-trial summaries

The 100 de novo trials are also summarized in five pre-specified bins:

1-20, 21-40, 41-60, 61-80, 81-100.

For each bin report:

- mean or median absolute initial cursor directional error,
- initial-direction-correct rate,
- hit rate,
- endpoint-miss rate,
- wrong-direction timeout rate,
- correct-direction-too-slow rate,
- no-cursor-effect rate,
- median Motor RT,
- median Task-relevant RT,
- median Task MT among completed reaches,
- median inter-hand onset lag,
- median hand-direction separation,
- median null fraction.

### 5.3 Early-versus-late acquisition contrast

Pre-specified contrast:

- early = trials 1-20,
- late = trials 81-100.

Primary comparison:

`absolute initial cursor directional error`

Secondary comparisons:

- initial-direction-correct rate,
- outcome composition,
- Task MT among completed reaches,
- hand-policy stability measures,
- null fraction.

### 5.4 Formal group model after pilot freeze

Primary acquisition model:

`absolute initial cursor directional error ~ trial + target + (1 + trial | participant)`

A pre-specified early-versus-late contrast is retained because the learning trajectory may be nonlinear.

Secondary binary model:

`initial direction correct ~ trial + target + (1 + trial | participant)`

with a binomial mixed-effects model.

Task hit remains secondary because it combines directional discovery with endpoint execution.

## 6. Discovery versus implementation

Discovery and implementation are analyzed separately.

Discovery is indexed primarily by initial cursor directional error.

Implementation is evaluated with:

- Task MT among completed reaches,
- Motor RT,
- Task-relevant RT,
- inter-hand onset lag,
- probability of completing within the 600-ms runtime window.

A `correct_direction_too_slow` trial is treated as discovery-correct but implementation-failed.

A fast movement in the wrong direction is not treated as successful implementation.

## 7. Individual discovery trajectories and structured exploration

The following are planned descriptive analyses, motivated by the individual-trajectory emphasis in Ding et al. (2026).

### 7.1 Individual trajectories

Plot each participant's trial-by-trial initial cursor directional error across all 100 de novo trials.

These plots are used to distinguish qualitatively different acquisition patterns such as:

- early successful discovery,
- gradual improvement,
- extended exploration before improvement,
- unstable acquisition,
- little or no acquisition.

These descriptors are used for visualization and interpretation and are not imposed as discrete participant categories.

### 7.2 Trial-by-trial directional-error heatmap

Construct a group-level heatmap with:

- x-axis = de novo trial,
- y-axis = target-normalized signed initial cursor directional error,
- intensity = frequency/density of observations.

The purpose is to show whether errors are diffusely distributed or repeatedly occupy similar angular regions, and how that structure evolves across learning.

### 7.3 Circular variability over learning

Quantify within-participant circular variability of initial cursor direction across the pre-specified trial bins.

The key descriptive question is whether early task-space exploration is broad and whether variability declines as participants acquire a stable policy.

### 7.4 Outcome timeline

Plot the trial-by-trial runtime outcome sequence for each participant:

- hit,
- endpoint miss,
- wrong-direction timeout,
- correct-direction-too-slow,
- no-cursor-effect.

This visualization is used to determine whether performance limitations primarily reflect unresolved directional discovery or implementation speed.

## 8. Movement-policy analysis

Primary policy outputs:

- left target-normalized policy error,
- right target-normalized policy error,
- hand-direction separation,
- null fraction,
- inter-hand onset lag.

Policy analyses answer how the participant implements a successful cursor solution rather than whether the movement is close to one canonical hand configuration.

### 8.1 Trial-by-trial hand-policy trajectory

Plot target-normalized left- and right-hand initial directions across trials.

This permits direct visualization of whether a participant retains a similar motor policy, reorganizes one hand more than the other, or uses substantial null-dimension movement while maintaining task-space performance.

### 8.2 Late-policy stability

Late policy is summarized over trials 81-100 using:

- dispersion of target-normalized left-hand direction,
- dispersion of target-normalized right-hand direction,
- hand-direction separation,
- null fraction,
- inter-hand onset lag.

The analysis does not assume that low null fraction or canonical orthogonal hand directions are required for successful learning.

## 9. Cross-target consistency of rule discovery

The two trained targets are governed by the same hidden component mapping.

Planned analyses therefore examine whether successful discovery at one target is accompanied by improved initial cursor direction when the other target next appears.

This analysis is described as cross-target consistency of rule discovery, not transfer or generalization, because both targets are part of the training set.

Relevant summaries include:

- target-specific initial directional error over trials,
- whether improvement is similar for the two targets,
- the first stable period of low directional error for each target,
- directional error on the next occurrence of the opposite target after a successful trial.

## 10. Explicit rule knowledge versus motor performance

The final four-item explicit probe is retained as a separate measure of component-rule knowledge.

Report:

- explicit-rule score (0-4),
- late initial cursor directional error,
- late direction-correct rate,
- late hit rate,
- late Task MT among completed reaches.

The analysis asks whether participants who can explicitly report the mapping can also express it as a stable bimanual motor policy.

Explicit knowledge is not used as a prerequisite for defining behavioral acquisition.

## 11. Post-baseline mapping-restoration analysis

The post-baseline block is treated as a mapping-restoration/carryover probe rather than being summarized only by the average across all 20 trials.

Pre-specified summaries:

- trial 1 signed endpoint error,
- mean signed and absolute endpoint error across trials 1-2,
- trials 1-4,
- all 20 trials,
- full trial-by-trial recovery curve.

This is intended to preserve transient carryover that may disappear rapidly after the original mapping is restored.

## 12. Runtime outcome data and raw-data reconstruction

Preferred source for task outcomes:

the detailed `reaches` records downloaded from Firestore.

Raw frames are used to compute offline onset, timing, cursor-direction, and hand-policy measures.

If an older pilot file lacks the detailed `reaches` array:

- trajectory and policy measures remain available from raw frames,
- per-attempt outcomes may be reconstructed approximately,
- reconstructed outcomes are explicitly labeled and are not substituted silently for exact runtime outcomes.

## 13. Pilot decision before formal recruitment

Before freezing the formal study, evaluate multiple genuinely naive participants under the same 100-trial acquisition schedule.

The decision to retain or modify the learning phase will consider:

- whether initial cursor directional error improves,
- whether late behavior is more stable than early behavior,
- whether the last 20 trials are meaningfully better than the first 20,
- whether failure remains dominated by unresolved directional search,
- whether correct-direction-too-slow trials are common enough to implicate the 600-ms window,
- whether explicit rule knowledge can be translated into stable motor performance,
- whether the offline onset and trajectory pipeline remains reliable across participants.

Novel-target transfer will be reconsidered only after acquisition is shown to be interpretable within the training phase.

## 14. Pilot-development note

The first naive pilot batch has already been inspected to identify technical and design failures. Therefore, the present document should not be described as a preregistration of analyses chosen before any data were observed.

Its purpose is to freeze the planned measurement and visualization framework prospectively for the next pilot batch and for subsequent task-development decisions.

## References used to motivate the analysis

- Ding W, Niyogi A, Taylor JA, Tsay JS. Hypothesis testing governs strategic motor learning. npj Science of Learning. 2026.
- Haith AM, Yang C, Pakpoor J, Kita K. De novo motor learning of a bimanual control task over multiple days of practice. 2022.
- Kita K, Du Y, Tran T, Haith AM. Switching between Newly Learned Motor Skills. Journal of Neuroscience. 2025.
