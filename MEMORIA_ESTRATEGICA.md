# ===========================================================================
# MEMÒRIA ESTRATÈGICA DEL MOTOR FERROVIARI
# ===========================================================================
# Aquest document recull les decisions arquitectòniques i algorísmiques del 
# projecte. L'objectiu és mantenir un creixement sumatiu i evitar regressions.
# Qualsevol canvi que contradigui aquests principis requereix un BACKUP previ.

## ESTRATÈGIA GLOBAL
- **Càlcul Dinàmic de Rutes**: El sistema ha de generar rutes ferroviàries realistes basades en coordenades (waypoints) i mapes d'OpenStreetMap (OSM), evitant salts cecs sempre que hi hagi infraestructura.
- **Dualitat de Xarxes (Modern vs Històric)**: El sistema ha de ser capaç de diferenciar i prioritzar entre línies d'Alta Velocitat (HSR) i línies convencionals segons el nom/tipus de ruta sol·licitada.

## ESTRATÈGIES ESPECÍFIQUES APLICADES

### 1. Estratègia "Columna Vertebral i Ramals" (Filtre de Servei)
- **Problema**: El tren es desviava per vies mortes, cotxeres o vies de manteniment.
- **Solució**: Penalització massiva (x2000) al pes matemàtic de totes les arestes marcades com a `service`, `siding` o `yard`.

### 2. Estratègia "Enllaç Tardà" (Late Binding) / "Look-ahead"
- **Problema**: "Punxes" i reculades en entrar a grans estacions perquè l'algorisme s'ancorava al primer node que trobava, independentment de si aquest node obligava a fer marxa enrere per sortir.
- **Solució**: Avaluar un clúster de vies a 300m de l'estació. Escollir l'andana que minimitza el cost d'arribada *i que alhora* apunta en la direcció de la següent ciutat (usant la distància de Haversine com a heurística de futur).

### 3. Estratègia "Taxació per Modalitat" (Anti-Espagueti)
- **Problema**: En xarxes mixtes paral·leles (ex: la Xina), l'algorisme saltava contínuament entre la via convencional i la d'Alta Velocitat (HSR) per esgarrapar metres, creant un efecte visual d'espagueti.
- **Solució**: Un cop decidit el mode (Modern/Històric), s'aplica una taxació dinàmica. Si el mode és Històric, les vies HSR es penalitzen (x50). Si el mode és Modern, les convencionals es penalitzen lleugerament (x15) per forçar el tren a mantenir-se al seu corredor, permetent l'ús de vies lentes només quan és estrictament necessari per entrar a les ciutats.