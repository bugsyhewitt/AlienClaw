# NOTICE: This file is a reference template. The installer (seed-installer.ts)
# assembles the actual .ms file with a freshly computed genome checksum.
# Do not edit the genome string here — edit the SeedSpec in seed-installer.ts.
#
# Format reference only (genome at top, then metadata, then tools, then graveyard):

[GENOME]
<assembled by seed-installer.ts using assembleGenome(identity, execution, behavior)>

# MS_FWRITE001
# description: File write Martian — executes file_write tool
# generation: 1
# status: active
# fitness: 0.00

[TOOLS]
file_write      → file_write.msb

[GRAVEYARD]
# Top performing historical genomes. Restored by CreatorBot only.
# format: <fitness_score> G<generation> <genome>
