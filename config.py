"""
Arxiu de configuració central.
Centralitza rutes de directoris i variables d'entorn per evitar codi duplicat.
"""
import os
import logging

# Configuració bàsica de Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)

# Rutes del sistema
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIR_PENDENTS = os.path.join(BASE_DIR, "dades", "pendents")
DIR_ARXIU = os.path.join(BASE_DIR, "dades", "originals_arxivats")
DIR_JSON = os.path.join(BASE_DIR, "dades", "json_publics")
DIR_GENERATOR = os.path.join(BASE_DIR, "generator")

# Variables de seguretat
MAX_CONTENT_LENGTH = 64 * 1024 * 1024  # 64MB per rutes massives

# Funcions d'inicialització
def inicialitzar_entorn():
    for directori in [DIR_PENDENTS, DIR_ARXIU, DIR_JSON]:
        os.makedirs(directori, exist_ok=True)