// Auto-generated from /sessions/wizardly-charming-darwin/mnt/Checkpro/CheckPro_Manual_Administrador.pdf
// y CheckPro_Manual_Empleados.pdf. Regenerar cuando cambien los manuales.
// Usado por /dashboard/help para busqueda de ayuda sin IA.

export const MANUAL_SECTIONS = [
  {
    "audience": "admin",
    "number": 1,
    "title": "Que es CheckPro",
    "body": "CheckPro es un sistema de reloj checador con GPS pensado para PyMES mexicanas. Tus empleados\nregistran entrada y salida desde un dispositivo (tablet o celular) que tu colocas en la sucursal, usando un\nPIN corto. CheckPro valida que la ubicacion este dentro del radio de la sucursal, clasifica la entrada como\npuntual, tolerancia, retardo o no laboral, y te entrega un reporte listo para nomina.\nQue ganas con CheckPro:\n• Control real de entradas y salidas, con evidencia de GPS.\n• Calculo automatico de horas trabajadas y retardos.\n• Cortes semanales de nomina con descarga en PDF.\n• Soporte para varias sucursales, cada una con su configuracion.\n• Roles: propietario, gerente (por sucursal) y super administrador.\nImportante. CheckPro es multi-empresa. Cada empresa (tenant) vive aislada: sus empleados,\nsus sucursales, su nomina. Tu empresa nunca comparte datos con otra."
  },
  {
    "audience": "admin",
    "number": 2,
    "title": "Primer acceso y registro de la empresa",
    "body": "Para empezar a usar CheckPro necesitas crear tu empresa. Solo se hace una vez.\nPasos:\n• Entra a checkpro-self.vercel.app desde cualquier navegador moderno.\n• Haz clic en Registrar empresa.\n• Llena nombre de la empresa, tu correo y una contrasena.\n• Confirma tu correo con el enlace que CheckPro te envia.\n• Al volver al sitio, entra con tu correo y contrasena: ya eres propietario.\nAl registrarte, CheckPro crea en automatico:\n• Tu empresa (tenant) en la base de datos.\n• Tu perfil como propietario.\n• Una primera sucursal con nombre Principal, lista para que la configures.\nSi iniciaste sesion y el sitio te regresa a la pantalla de acceso: espera unos segundos y\nvuelve a intentar. Si persiste, avisanos: suele ser un tema de politicas de base de datos que se\nresuelve del lado del servidor."
  },
  {
    "audience": "admin",
    "number": 3,
    "title": "Tu panel de administrador",
    "body": "Despues de iniciar sesion entras al panel. En la columna izquierda ves las secciones: Hoy, Empleados,\nAsistencia, Nomina, Configuracion. Arriba a la derecha aparecen tu nombre y la empresa.\nQue hay en cada seccion:\nSeccion\nPara que sirve\nHoy\nResumen del dia: quienes ya checaron, quienes no, retardos.\nEmpleados\nAlta, baja y edicion de empleados. Aqui se genera el PIN.\nAsistencia\nVer jornadas, corregir horas, marcar festivos.\nNomina\nCorte semanal, calculo de horas y descarga en PDF.\nConfiguracion\nEmpresa, sucursales, tolerancia, horarios, festivos."
  },
  {
    "audience": "admin",
    "number": 4,
    "title": "Sucursales",
    "body": "Una sucursal es una ubicacion fisica donde trabajan tus empleados: una tienda, una oficina, un taller.\nCheckPro soporta varias sucursales por empresa. Cada empleado pertenece a una sola sucursal. Cada\ngerente tambien - solo puede ver y operar la suya.\n• Crear una sucursal\nEntra a Configuracion > Sucursales.\nPulsa Agregar sucursal.\nLlena: nombre visible, direccion corta.\nAbre la sucursal y pulsa Capturar ubicacion desde un dispositivo que este en el lugar.\nAjusta el radio permitido (por defecto 300 m).\nGuarda. La sucursal queda activa.\nCapturar GPS\nLa captura de coordenadas debe hacerse desde el lugar, con el dispositivo que va a quedar como\nchecador o con tu celular parado en la entrada. El navegador te pedira permiso de ubicacion: concedelo.\nCheckPro guarda latitud, longitud y radio. A partir de ahi, cualquier intento de checar fuera del circulo se\nrechaza.\nTip. Si la sucursal cubre dos pisos o un patio grande, amplia el radio a 400 - 500 m. Si tienes dos\nlocales cercanos en la misma calle, considera crearlos como sucursales distintas para que cada\nempleado quede atado a la suya.\n• Editar o desactivar una sucursal\nDesde Configuracion > Sucursales puedes editar nombre, GPS y radio.\nDesactivar una sucursal no borra su historia; solo impide nuevas jornadas.\nAntes de desactivar, mueve a los empleados a otra sucursal o dalos de baja."
  },
  {
    "audience": "admin",
    "number": 5,
    "title": "Empleados",
    "body": "Los empleados no tienen cuenta de correo en CheckPro. Se identifican con un codigo (ej. EMP001) y un\nPIN de 4 a 6 digitos. Esta combinacion se usa en el dispositivo checador para marcar entrada y salida.\n• Dar de alta a un empleado\nEntra a Empleados > Nuevo.\nNombre completo.\nSucursal a la que pertenece.\nDepartamento (opcional).\nPIN de 4 a 6 digitos. Sugerencia: que lo elija el empleado.\nSalario mensual (para calcular hora).\nHorario semanal: lunes a domingo, con hora de entrada y salida.\nDias de descanso (normalmente domingo).\nGuardar.\nCampos importantes\nCampo\nSirve para\nCodigo\nIdentificarlo en el checador. Se genera automatico (EMP001, EMP002...).\nPIN\nAutenticacion en el checador. No se muestra despues; se puede regenerar.\nHorario\nDetectar puntualidad, tolerancia y retardo.\nSalario mensual\nCalcular tarifa por hora y total de nomina.\nPuede gestionar\nSi lo habilitas, el empleado puede aprobar cubrir turnos.\nTiene turno\nDesactivado para empleados por honorarios o sin horario fijo.\nMover empleado entre sucursales\nEntra al empleado, cambia la sucursal, guarda. Las jornadas pasadas siguen asociadas a la sucursal\ndonde se originaron; a partir del cambio, las nuevas jornadas quedan en la nueva sucursal."
  },
  {
    "audience": "admin",
    "number": 6,
    "title": "Gerentes e invitaciones",
    "body": "El gerente es una cuenta con acceso al panel (como tu) pero limitada a una sola sucursal. Usalo para\ndelegar la operacion diaria sin entregar el control total de la empresa.\nUna empresa puede tener varios gerentes\nSi tienes tres sucursales, puedes invitar un gerente por cada una. Tambien puedes invitar dos gerentes a\nla misma sucursal (por ejemplo, turno matutino y vespertino). No hay limite duro.\n• Invitar un gerente\nEntra a Configuracion > Equipo.\nPulsa Invitar gerente.\nEscribe su correo y elige la sucursal que va a manejar.\nCheckPro envia un enlace magico al correo. Al abrirlo, el gerente crea su contrasena y queda listo.\n• Que puede ver un gerente\nEmpleados de su sucursal.\nAsistencia de su sucursal.\nNomina de su sucursal (si lo habilitas).\nConfiguracion de sucursal: horarios, tolerancia, festivos locales.\n• Que NO puede hacer un gerente\nVer otras sucursales.\nCrear o borrar sucursales.\nInvitar o dar de baja otros gerentes.\nCambiar el plan o la facturacion.\nPasar un gerente a propietario (o al reves)\nEn el panel de super administrador (reservado al dueno del sistema) puedes promover un gerente a\npropietario. Al hacerlo, la cuenta pierde la restriccion por sucursal y queda con permisos completos sobre\nla empresa. El caso contrario - pasar un propietario a gerente - se usa cuando cambias de mano la\nempresa y quieres que el dueno anterior quede con acceso limitado."
  },
  {
    "audience": "admin",
    "number": 7,
    "title": "Configuracion de la empresa",
    "body": "La configuracion de empresa aplica a toda la organizacion. Lo que definas aqui se hereda a cada\nsucursal, que a su vez puede sobrescribirlo.\n• Campos principales\nNombre visible: aparece arriba en el panel y en los PDF de nomina.\nLogo de empresa: imagen cuadrada, al menos 400x400 px.\nFrase corporativa: aparece debajo del logo en el checador si la sucursal no tiene frase propia.\nDia de cierre semanal: por defecto domingo. Es el corte de nomina.\nZona horaria: America/Mexico_City.\nPlan: free, pro, enterprise. Lo cambias al integrar pago."
  },
  {
    "audience": "admin",
    "number": 8,
    "title": "Configuracion de cada sucursal",
    "body": "Cada sucursal puede tener sus propias reglas. Si una sucursal deja un campo en blanco, se usa el valor\nde la empresa.\nCampos por sucursal\nCampo\nQue hace\nDefault\nTolerancia\nMinutos despues de la hora para no contar retardo.\n10 min\nHoras alerta\nA partir de cuantas horas se alerta jornada larga.\n10 h\nRadio GPS\nDistancia en metros desde el punto de la sucursal.\n300 m\nFestivos locales\nDias en los que se paga triple.\nlista nacional\nDias de descanso\nDias que por regla no se trabaja; si se trabajan, pagan doble.\ndomingo\nHorario comercial\nRango en el que el checador acepta marcajes.\n05:00 - 23:59\nLogo de sucursal\nImagen que se muestra en el checador de esa sucursal.\n(opcional)\nFrase de sucursal\nTexto chico debajo del logo en el checador.\n(opcional)\nBuena practica. Define la tolerancia y los festivos en la empresa, y solo sobrescribe en la\nsucursal cuando haya una razon (por ejemplo, una sucursal turistica que abre 7 dias)."
  },
  {
    "audience": "admin",
    "number": 9,
    "title": "El dispositivo checador",
    "body": "El checador es una pantalla sencilla que vive en la URL /check. No requiere cuenta; solo que el\nnavegador del dispositivo tenga guardada la sucursal. Puede correr en una tablet, un celular viejo, una\nlaptop pegada al mostrador o en el celular personal del empleado (escaneando un QR que le entrega el\ngerente).\n• Preparar un dispositivo fijo\nAbre /check en el navegador del dispositivo.\nEntra a modo administrador con tu PIN de propietario.\nSelecciona la sucursal.\nConfirma la ubicacion GPS.\nSal del modo administrador. El dispositivo queda pegado a esa sucursal.\n• Flujo del empleado\nAbre el checador (o escanea el QR de la sucursal).\nEscribe su codigo (EMP001) y su PIN.\nEl checador valida GPS y muestra Entrada registrada / Salida registrada.\nClasifica automaticamente: puntual, tolerancia, retardo o no laboral.\nQue pasa si el empleado esta fuera del radio\nSe rechaza el marcaje con un mensaje: Estas fuera del radio permitido. El incidente queda en el audit log.\nEl gerente puede corregirlo despues desde Asistencia."
  },
  {
    "audience": "admin",
    "number": 10,
    "title": "Asistencia: ver y corregir jornadas",
    "body": "Cada marcaje genera una fila en la tabla de jornadas (shifts). Desde Asistencia puedes filtrar por\nsucursal, empleado, fecha y estado (abierta, cerrada, incidencia).\n• Correcciones manuales\nClic en la jornada para abrirla.\nPuedes editar entrada, salida, marcar festivo o marcar cubriendo a otro empleado.\nCada cambio queda en la lista de correcciones con fecha, quien lo hizo y motivo.\nNada se borra: siempre queda rastro.\nClasificacion\nEstado\nCuando se asigna\npuntual\nLlego antes o a la hora marcada en su horario.\ntolerancia\nLlego dentro del rango de tolerancia (ej. 10 min despues).\nretardo\nLlego despues de la tolerancia.\nno_laboral\nLlego en un dia que su horario marca como descanso."
  },
  {
    "audience": "admin",
    "number": 11,
    "title": "Nomina y cortes semanales",
    "body": "El corte semanal toma todas las jornadas cerradas entre el ultimo corte y la fecha indicada, calcula horas\ntrabajadas, retardos, dias festivos y descansos trabajados, y produce el total a pagar por empleado.\n• Hacer un corte\nEntra a Nomina > Nuevo corte.\nElige sucursal (o todas, si eres propietario).\nElige periodo: por defecto, lunes a domingo de la semana anterior.\nRevisa el preview.\nPulsa Cerrar corte y Descargar PDF.\nFormula resumida\nTarifa por hora = salario mensual / (dias laborales del mes * horas por dia). Dia festivo trabajado: pago\ntriple. Dia de descanso trabajado: pago doble. Retardos: por defecto no se descuentan, pero puedes\ncambiar la regla en Configuracion.\nImportante. Un corte cerrado no se puede reabrir desde el panel normal para evitar manipulacion\ndespues de pagar. Si necesitas corregir algo, contacta al super administrador."
  },
  {
    "audience": "admin",
    "number": 12,
    "title": "Identidad: logo de empresa y de sucursal",
    "body": "CheckPro distingue dos niveles de marca. La identidad de empresa es tu marca corporativa y aparece\nen el panel, en los PDF de nomina y en el checador cuando la sucursal no tiene marca propia. La\nidentidad de sucursal es opcional y se usa cuando quieres que el checador de una sucursal especifica\nmuestre otro logo o frase.\nCuando usar identidad de sucursal\n• Franquiciados con marca compartida pero nombre local.\n• Sucursales piloto con branding distinto.\n• Talleres internos cuya \"sucursal\" es de una empresa hermana.\nRecomendacion de imagenes\n• Logo: PNG con fondo transparente, minimo 400x400 px.\n• Frase: maximo 60 caracteres.\n• Evita texto sobre fondo detallado; en el checador queda sobre fondo oscuro."
  },
  {
    "audience": "admin",
    "number": 13,
    "title": "Roles y permisos - resumen",
    "body": "Accion\nSuper admin\nPropietario\nGerente\nEmpleado\nCrear empresa\nsi\n-\n-\n-\nCrear sucursales\nsi\nsi\n-\n-\nInvitar gerentes\nsi\nsi\n-\n-\nVer todas las sucursales\nsi\nsi\n-\n-\nVer su sucursal\nsi\nsi\nsi\n-\nDar de alta empleados\nsi\nsi\nsi (su suc.)\n-\nHacer corte de nomina\nsi\nsi\nsi (su suc.)\n-\nDescargar PDF\nsi\nsi\nsi (su suc.)\n-\nMarcar entrada/salida\n-\n-\n-\nsi\nCambiar rol / borrar usuarios\nsi\n-\n-\n-\nVer panel super admin\nsi\n-\n-\n-"
  },
  {
    "audience": "admin",
    "number": 14,
    "title": "Solucion de problemas frecuentes",
    "body": "Al iniciar sesion el sitio me regresa a Login\nCasi siempre es un tema del servidor de base de datos. Espera 30 segundos y vuelve a entrar. Si sigue,\ncontacta soporte - es un caso conocido que se arregla del lado de la DB.\nEl empleado dice que su PIN no funciona\nVerifica en Empleados que su estatus siga en activo y que el codigo que esta tecleando sea el correcto.\nPuedes regenerar el PIN desde el detalle del empleado.\nMarca \"fuera del radio\" aunque este en la sucursal\nRevisa la captura de GPS de la sucursal y amplia el radio. El GPS puede variar 20-50 m bajo techo.\nNo me deja invitar al gerente\nSolo el propietario o el super admin pueden invitar. Si eres propietario y aun no te deja, revisa que hayas\nverificado tu correo.\nUn empleado no aparece en el corte de nomina\nProbablemente no tiene jornadas cerradas en el periodo. Revisa en Asistencia si sus jornadas estan\nabiertas.\nDos empleados marcan entradas muy juntas y una sale \"retardo\"\nSus relojes internos pueden diferir unos segundos. Si los dos estan dentro de la tolerancia, ambos seran\npuntuales; si uno entra al minuto 11 y la tolerancia es 10, ese es retardo por regla.\nQuiero reabrir un corte ya cerrado\nDesde el panel no se puede. Contacta al super admin con la razon (por ejemplo, correccion de un\nfestivo)."
  },
  {
    "audience": "admin",
    "number": 15,
    "title": "Glosario",
    "body": "Termino\nDefinicion\nTenant\nEmpresa registrada en CheckPro. Aislada de otras empresas.\nSucursal\nUbicacion fisica de trabajo. Una empresa puede tener varias.\nPropietario\nCuenta con permisos totales sobre una empresa.\nGerente\nCuenta con permisos solo sobre su sucursal.\nSuper admin\nCuenta global del dueno del sistema. Mantenimiento y soporte.\nPIN\nCodigo corto que usa el empleado en el checador. No es contrasena.\nJornada (shift)\nPar entrada-salida de un empleado en un dia.\nTolerancia\nMargen en minutos despues de la hora oficial antes de marcar retardo.\nClasificacion\nEtiqueta automatica de una jornada: puntual, tolerancia, retardo, no laboral.\nCorte\nPeriodo cerrado de nomina; suele ser semanal.\nAudit log\nBitacora de todos los eventos importantes; no se borra.\nFin del manual. Edicion 2 - Abril 2026."
  },
  {
    "audience": "empleado",
    "number": 1,
    "title": "Lo que necesitas saber",
    "body": "CheckPro es el sistema que usa tu empresa para registrar tu hora de entrada y salida. No necesitas\n• crear cuenta ni contrasena. Solo necesitas dos cosas:\nTu codigo de empleado, por ejemplo EMP001.\nTu PIN de 4 a 6 digitos.\nTu gerente o el administrador te los entrega el primer dia. El PIN es secreto: no lo compartas con\nnadie, ni lo dejes escrito a la vista.\nSi olvidas tu PIN: pide a tu gerente que lo reinicie. Se te generara uno nuevo.\nGuarda este manual cerca del checador"
  },
  {
    "audience": "empleado",
    "number": 2,
    "title": "Como checar entrada y salida",
    "body": "Dos opciones, segun lo que tu empresa use:\n• Opcion A - Dispositivo de la sucursal\nAcercate al checador (tablet, celular o computadora en el mostrador).\nEscribe tu codigo (EMP001, EMP007, etc.).\nEscribe tu PIN.\nPulsa Entrar o Salir segun corresponda.\nEspera el mensaje Entrada registrada o Salida registrada.\nOpcion B - Tu celular con codigo QR\n• En algunas sucursales se usa un codigo QR pegado en la entrada. El flujo es:\nAbre la camara de tu celular y enfoca el QR de tu sucursal.\nSe abrira el checador de esa sucursal en tu navegador.\nEl navegador pedira permiso de ubicacion: concedelo.\nEscribe tu codigo y tu PIN.\nPulsa Entrar o Salir.\nGuarda el sitio en favoritos o en tu pantalla de inicio para usos futuros.\nImportante. El sistema verifica por GPS que estes en la sucursal. Si intentas checar fuera\ndel radio, el sistema rechaza el marcaje y tu gerente recibe el aviso.\nGuarda este manual cerca del checador"
  },
  {
    "audience": "empleado",
    "number": 3,
    "title": "Que significan puntual, tolerancia y retardo",
    "body": "Cuando marcas entrada, el sistema la clasifica automaticamente segun tu horario.\nClasificacion\nCuando se asigna\nPuntual\nLlegaste antes o justo a la hora de entrada.\nTolerancia\nLlegaste dentro del margen que tu empresa permite (tipico: 10 min).\nRetardo\nLlegaste despues de la tolerancia.\nNo laboral\nLlegaste en un dia que no te toca trabajar.\nLa pantalla del checador te muestra el resultado despues de marcar. Si te sale retardo, tu gerente\npuede revisarlo contigo. No discutas con el dispositivo: todo queda registrado y se puede corregir\ndesde el panel si hay un error real.\nGuarda este manual cerca del checador"
  },
  {
    "audience": "empleado",
    "number": 4,
    "title": "Si tu empresa tiene varias sucursales",
    "body": "Cada sucursal tiene su propio checador y su propio codigo QR. Tu cuenta esta asociada a una sola\nsucursal. Si llegas a otra sucursal de la misma empresa, el sistema rechazara tu marcaje con un\nmensaje.\n• Que hacer si te mandan temporalmente a otra sucursal:\nAvisa a tu gerente: el puede moverte temporalmente a esa sucursal.\nO dejar que registre tu jornada manualmente y te explique el movimiento.\nEn la pantalla del checador siempre aparece el nombre o logo de la sucursal arriba. Antes de meter\ntu codigo y PIN, verifica que sea la tuya.\nGuarda este manual cerca del checador"
  },
  {
    "audience": "empleado",
    "number": 5,
    "title": "Que hacer si algo falla",
    "body": "El checador no me reconoce\nRevisa que estes tecleando bien tu codigo (EMP + numero) y tu PIN. Si sigue fallando, pide a tu\ngerente que verifique tu cuenta - puede estar inactiva.\nMe marca \"fuera del radio\"\nAsegurate de estar dentro de la sucursal, no en la banqueta ni en el estacionamiento. Si a pesar de\nestar dentro te rechaza, avisa al gerente: puede ser que el GPS necesite ajuste.\nOlvide mi PIN\nEl gerente puede regenerarlo. Despues de eso, el sistema te da uno nuevo.\nMarque entrada pero no salida\nTu jornada quedo abierta. Avisale a tu gerente o pasate por el checador al dia siguiente: el sistema te\npermitira cerrar la jornada con una nota.\nMarque dos veces la entrada\nNo pasa nada: el sistema toma la primera entrada valida y ignora la segunda.\nEl dispositivo esta apagado\nUsa el codigo QR con tu celular, o avisa al gerente para que registre tu hora de entrada\nmanualmente.\nGuarda este manual cerca del checador\n• 6. Buenas practicas\nCheca antes de cambiarte o empezar tareas: la hora del marcaje es la que cuenta.\nSi se te olvida salir, avisa ese mismo dia. Recuperarlo despues es mas complicado.\nCuida tu PIN. Si sientes que alguien lo sabe, pide cambiarlo.\nNo prestes tu codigo ni tu PIN a un companero. Cada intento queda registrado.\nSi tu horario cambia, verifica con el gerente que este actualizado en el sistema antes de\nreclamar retardos.\nCualquier duda, tu gerente tiene el Manual del Administrador con todas las respuestas.\nGuarda este manual cerca del checador"
  }
];
